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
  /**
   * Which strategy produced this signal. Not optional: defaulting it is how the
   * guard came to judge every mean-reversion entry as a failed crossover.
   */
  strategy: "trend_following" | "mean_reversion" | "scalp";
  regime: "trending" | "ranging" | null;
  adx: number | null;
  rsi: number | null;
}

export interface SignalReview {
  approved: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
}

/**
 * Guard mode: a strategy has produced a BUY/SELL signal. Claude reviews it
 * against the market context and account state and decides whether to approve
 * or veto BEFORE any order is placed.
 *
 * The prompt MUST describe the strategy that actually fired. It used to say
 * "a moving-average crossover strategy" for every signal, while the engine
 * routes ranging instruments to mean-reversion instead. The guard then judged
 * mean-reversion entries by trend-following logic and vetoed all 35 of them in
 * 22 hours — every time for "price is below both moving averages", which is
 * precisely what that strategy waits for. The reasoning was sound; the premise
 * it was handed was false, and the engine placed no trade at all for a week.
 */
export function describeStrategy(input: SignalReviewInput): string {
  switch (input.strategy) {
    case "mean_reversion":
      return `A MEAN-REVERSION strategy has produced a ${input.side} signal for ${input.ticker}. It buys when price is oversold (RSI low AND at or below the lower Bollinger band) and sells when overbought, betting the move reverts. Price sitting beyond the moving averages is the SETUP for this strategy, not a contradiction — do not treat it as one. The moving averages below are context only; this signal did not come from a crossover.`;
    case "scalp":
      return `A fast MEAN-REVERSION scalp strategy has produced a ${input.side} signal for ${input.ticker}. It fades a stretched one-minute move back toward a short EMA, aiming for a fraction of a percent. Price being extended away from the EMA is the setup, not a contradiction.`;
    case "trend_following":
    default:
      return `A MOVING-AVERAGE CROSSOVER strategy (short MA period ${input.shortPeriod}, long MA period ${input.longPeriod}) has produced a ${input.side} signal for ${input.ticker}. It follows the trend: a valid BUY needs the short MA above the long MA, and a valid SELL the reverse.`;
  }
}

export async function reviewSignal(input: SignalReviewInput, log: Logger): Promise<SignalReview> {
  const indicators = [
    `- Latest price: ${fmtNum(input.price)}`,
    `- Short MA: ${fmtNum(input.shortMa)}`,
    `- Long MA: ${fmtNum(input.longMa)}`,
    input.regime ? `- Market regime: ${input.regime}${input.adx !== null ? ` (ADX ${fmtNum(input.adx)})` : ""}` : null,
    input.rsi !== null ? `- RSI: ${fmtNum(input.rsi)}` : null,
  ].filter(Boolean) as string[];

  const prompt = `You are a disciplined risk manager for an automated day-trading bot. ${describeStrategy(input)}

Current data:
${indicators.join("\n")}
- ${accountLine(input.account)}
- ${positionsLines(input.positions)}

Decide whether this trade should be APPROVED or VETOED. Judge it against the logic of the strategy that produced it, described above — not against a different strategy's rules. Veto if the signal looks weak ON ITS OWN TERMS, contradicts the current position/exposure, or the risk is poor. Approve only if it is a reasonable, disciplined entry.

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
