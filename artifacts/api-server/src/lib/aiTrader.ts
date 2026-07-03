import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Logger } from "pino";

const MODEL = "claude-sonnet-4-6";

export interface AccountSnapshot {
  cash: number;
  total: number;
  currency: string | null;
}

export interface PositionSnapshot {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  pnlPercent: number;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Recover JSON embedded in prose. Try both array and object slices and use
    // whichever parses — the array case matters for decideTrades() responses.
    const candidates: string[] = [];
    const aStart = trimmed.indexOf("[");
    const aEnd = trimmed.lastIndexOf("]");
    if (aStart !== -1 && aEnd > aStart) candidates.push(trimmed.slice(aStart, aEnd + 1));
    const oStart = trimmed.indexOf("{");
    const oEnd = trimmed.lastIndexOf("}");
    if (oStart !== -1 && oEnd > oStart) candidates.push(trimmed.slice(oStart, oEnd + 1));

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // try next candidate
      }
    }
    throw new Error("Claude response did not contain valid JSON");
  }
}

async function callClaude(prompt: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  if (!text) throw new Error("Claude returned an empty response");
  return text;
}

function fmtNum(n: number, digits = 4): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function accountLine(account: AccountSnapshot | null): string {
  if (!account) return "Account balance: unavailable.";
  const cur = account.currency ?? "";
  return `Account: total ${fmtNum(account.total, 2)} ${cur}, available cash ${fmtNum(account.cash, 2)} ${cur}.`;
}

function positionsLines(positions: PositionSnapshot[]): string {
  if (positions.length === 0) return "Open positions: none.";
  return (
    "Open positions:\n" +
    positions
      .map(
        (p) =>
          `- ${p.ticker}: qty ${fmtNum(p.quantity)}, avg ${fmtNum(p.averagePrice)}, now ${fmtNum(
            p.currentPrice
          )}, P/L ${p.pnlPercent >= 0 ? "+" : ""}${p.pnlPercent.toFixed(2)}%`
      )
      .join("\n")
  );
}

// ── Mode 1: safety check (guard) ──────────────────────────────────────────

export interface SignalReviewInput {
  ticker: string;
  side: "BUY" | "SELL";
  price: number;
  shortMa: number;
  longMa: number;
  shortPeriod: number;
  longPeriod: number;
  account: AccountSnapshot | null;
  positions: PositionSnapshot[];
}

export interface SignalReview {
  approved: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
}

/**
 * Guard mode: a moving-average crossover has produced a BUY/SELL signal.
 * Claude reviews it against the market context and account state and decides
 * whether to approve or veto BEFORE any order is placed.
 */
export async function reviewSignal(input: SignalReviewInput, log: Logger): Promise<SignalReview> {
  const prompt = `You are a disciplined risk manager for an automated day-trading bot. A moving-average crossover strategy (short MA period ${input.shortPeriod}, long MA period ${input.longPeriod}) has produced a ${input.side} signal for ${input.ticker}.

Current data:
- Latest price: ${fmtNum(input.price)}
- Short MA: ${fmtNum(input.shortMa)}
- Long MA: ${fmtNum(input.longMa)}
- ${accountLine(input.account)}
- ${positionsLines(input.positions)}

Decide whether this trade should be APPROVED or VETOED. Veto if the signal looks weak, contradicts the current position/exposure, or the risk is poor. Approve only if it is a reasonable, disciplined entry.

Respond with ONLY valid JSON (no markdown, no code fences) of the exact shape:
{"approved": boolean, "confidence": "low" | "medium" | "high", "reason": string}
Keep "reason" to one or two short, plain-English sentences a non-expert can understand.`;

  const text = await callClaude(prompt);
  const parsed = extractJson(text) as Record<string, unknown>;
  const approved = parsed["approved"] === true;
  const confidenceRaw = String(parsed["confidence"] ?? "").toLowerCase();
  const confidence: SignalReview["confidence"] =
    confidenceRaw === "high" ? "high" : confidenceRaw === "low" ? "low" : "medium";
  const reason =
    typeof parsed["reason"] === "string" && parsed["reason"].trim()
      ? parsed["reason"].trim()
      : approved
        ? "Approved."
        : "Vetoed.";
  log.info({ ticker: input.ticker, side: input.side, approved, confidence }, "AI signal review");
  return { approved, confidence, reason };
}

// ── Mode 2: decision-maker (autonomous) ───────────────────────────────────

export interface CandidateInstrument {
  ticker: string;
  price: number;
  shortMa: number | null;
  longMa: number | null;
}

export interface TradeDecision {
  ticker: string;
  action: "BUY" | "SELL" | "HOLD";
  confidence: "low" | "medium" | "high";
  reason: string;
}

/**
 * Autonomous mode: Claude itself decides what to do for each candidate
 * instrument, using price/MA context, account balance and open positions.
 */
export async function decideTrades(
  candidates: CandidateInstrument[],
  account: AccountSnapshot | null,
  positions: PositionSnapshot[],
  log: Logger
): Promise<TradeDecision[]> {
  const instrumentLines = candidates
    .map((c) => {
      const ma =
        c.shortMa != null && c.longMa != null
          ? `, short MA ${fmtNum(c.shortMa)}, long MA ${fmtNum(c.longMa)}`
          : "";
      return `- ${c.ticker}: price ${fmtNum(c.price)}${ma}`;
    })
    .join("\n");

  const prompt = `You are a disciplined day-trading decision engine for an automated bot. Decide, for each instrument below, whether to BUY, SELL, or HOLD right now. Be conservative: prefer HOLD unless there is a clear, reasonable edge. Consider trend, the account balance, and existing exposure. Do not risk more than is sensible.

Instruments:
${instrumentLines}

${accountLine(account)}
${positionsLines(positions)}

Respond with ONLY valid JSON (no markdown, no code fences): an array with exactly one object per instrument, in the same order:
[{"ticker": string, "action": "BUY" | "SELL" | "HOLD", "confidence": "low" | "medium" | "high", "reason": string}]
Keep each "reason" to one short, plain-English sentence a non-expert can understand.`;

  const text = await callClaude(prompt);
  const parsed = extractJson(text);
  const arr = Array.isArray(parsed) ? parsed : [];
  const byTicker = new Map<string, TradeDecision>();
  for (const raw of arr) {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const ticker = String(obj["ticker"] ?? "").trim();
    if (!ticker) continue;
    const actionRaw = String(obj["action"] ?? "HOLD").toUpperCase();
    const action: TradeDecision["action"] =
      actionRaw === "BUY" ? "BUY" : actionRaw === "SELL" ? "SELL" : "HOLD";
    const confidenceRaw = String(obj["confidence"] ?? "").toLowerCase();
    const confidence: TradeDecision["confidence"] =
      confidenceRaw === "high" ? "high" : confidenceRaw === "low" ? "low" : "medium";
    const reason =
      typeof obj["reason"] === "string" && obj["reason"].trim() ? obj["reason"].trim() : "No reason given.";
    byTicker.set(ticker.toLowerCase(), { ticker, action, confidence, reason });
  }

  // Guarantee a decision for every candidate; default to HOLD if the model drifted.
  const decisions = candidates.map((c) => {
    const found = byTicker.get(c.ticker.toLowerCase());
    if (found) return { ...found, ticker: c.ticker };
    return {
      ticker: c.ticker,
      action: "HOLD" as const,
      confidence: "low" as const,
      reason: "No decision returned for this instrument; holding.",
    };
  });
  log.info({ count: decisions.length }, "AI autonomous decisions");
  return decisions;
}
