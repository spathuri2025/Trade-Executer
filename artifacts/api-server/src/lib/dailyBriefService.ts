import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { MarketUpdate } from "@workspace/db";
import type { Logger } from "pino";

const DISCLAIMER =
  "Trading involves risk. This report is for educational purposes and is not financial advice.";

const MARKETS = ["Crude Oil WTI", "Gold", "S&P 500", "Bitcoin"];

/**
 * The analyst prompt — kept short and decision-focused per product owner.
 *
 * It now REQUIRES searching, and that is not a refinement. Until 5 Oct 2026
 * this prompt was sent with no tools at all, so every "key support and
 * resistance level" and every "important news/event" was written from the
 * model's training data and shown to the user as today's market. The briefing
 * described "today's headlines about an AI reality check dragging the S&P 500
 * to 5,000" on a day no such headline existed, while the assistant — asked the
 * same thing — correctly said it had no news. The honest half of the product
 * was the half that looked broken.
 *
 * Levels and events are claims about the world. They are either looked up or
 * they are not stated.
 */
export function briefPrompt(): string {
  return (
    "You are the TradeBuzz Daily Market Analyst. Create a SHORT, easy-to-read daily market brief for day traders covering Crude Oil WTI, Gold, S&P 500 and Bitcoin. " +
    "FIRST, use web search to find today's actual price action, levels and news for each of those four markets. " +
    "Every number and every event you mention must come from something you found just now — never from memory, which is out of date. " +
    "If you cannot find current information for one of the markets, say so for that market instead of estimating. " +
    "For each market give the directional bias, the key support and resistance levels, and ONE short plain-language paragraph (2-3 sentences, max ~60 words) that a busy trader can skim to make a decision. " +
    "That paragraph should fold together what matters most today: the outlook, any important news/events, high-risk periods to watch, and the main technical observation — in everyday language, no jargon, no walls of text. " +
    "Do not give guaranteed buy/sell signals. Always include: Trading involves risk. This report is for educational purposes and is not financial advice."
  );
}

/** Appended so the model returns parseable, structured JSON we can render per market. */
const FORMAT_INSTRUCTION = `

Respond with ONLY a valid JSON object (no markdown, no code fences, no commentary) of the exact shape:
{
  "markets": [
    {
      "name": string,        // one of: "Crude Oil WTI", "Gold", "S&P 500", "Bitcoin"
      "bias": string,        // short directional lean, e.g. "Bullish", "Bearish", "Neutral"
      "support": string,     // key support level(s), just the number(s)
      "resistance": string,  // key resistance level(s), just the number(s)
      "summary": string      // ONE short paragraph, 2-3 sentences (max ~60 words), plain language, decision-focused
    }
  ],
  "disclaimer": string       // must equal: "${DISCLAIMER}"
}
Include exactly one entry for each of: Crude Oil WTI, Gold, S&P 500, Bitcoin, in that order. Keep every field concise. Do not give guaranteed buy/sell signals.`;

export interface GeneratedBrief {
  markets: MarketUpdate[];
  disclaimer: string;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value);
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Model occasionally wraps JSON in prose or code fences — recover the object.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Claude response did not contain valid JSON");
  }
}

function normalizeMarket(raw: unknown): MarketUpdate {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    name: asString(obj["name"]),
    bias: asString(obj["bias"]),
    support: asString(obj["support"]),
    resistance: asString(obj["resistance"]),
    summary: asString(obj["summary"]),
  };
}

export async function generateDailyBrief(log: Logger): Promise<GeneratedBrief> {
  // No fallback to a search-free call on purpose. A brief without search is a
  // brief of invented levels and invented headlines, which is worse than no
  // brief: the page would look identical and the reader could not tell. If the
  // gateway ever stops offering the tool, this throws and the last real brief
  // stays on the page.
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    messages: [{ role: "user", content: briefPrompt() + FORMAT_INSTRUCTION }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  if (!text) {
    throw new Error("Claude returned an empty response");
  }

  const parsed = extractJson(text) as Record<string, unknown>;
  const rawMarkets = Array.isArray(parsed["markets"]) ? (parsed["markets"] as unknown[]) : [];

  const byName = new Map<string, MarketUpdate>();
  for (const m of rawMarkets) {
    const market = normalizeMarket(m);
    if (market.name) byName.set(market.name.toLowerCase(), market);
  }

  // Guarantee all four markets are present and ordered, even if the model drifts.
  const markets: MarketUpdate[] = MARKETS.map((name, idx) => {
    const found =
      byName.get(name.toLowerCase()) ??
      (rawMarkets[idx] ? normalizeMarket(rawMarkets[idx]) : undefined);
    if (found) return { ...found, name };
    log.warn({ market: name }, "Daily brief missing a market; inserting placeholder");
    return {
      name,
      bias: "Unavailable",
      support: "Unavailable",
      resistance: "Unavailable",
      summary: "Data for this market was not returned. Please regenerate the brief.",
    };
  });

  // Hard product requirement: the brief must always carry the exact mandated
  // risk wording. Never trust the model's version — pin it to the canonical string.
  return { markets, disclaimer: DISCLAIMER };
}
