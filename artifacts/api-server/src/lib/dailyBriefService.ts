import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { MarketUpdate } from "@workspace/db";
import type { Logger } from "pino";

const DISCLAIMER =
  "Trading involves risk. This report is for educational purposes and is not financial advice.";

const MARKETS = ["Crude Oil WTI", "Gold", "S&P 500", "Bitcoin"];

/** The exact analyst prompt provided by the product owner. */
const BASE_PROMPT =
  "You are the TradeBuzz Daily Market Analyst. Create a professional daily market brief for day traders covering Crude Oil WTI, Gold, S&P 500 and Bitcoin. For each market include market bias, key support, key resistance, important news/events, high-risk trading periods, technical observations and an educational summary. Do not give guaranteed buy/sell signals. Always include: Trading involves risk. This report is for educational purposes and is not financial advice.";

/** Appended so the model returns parseable, structured JSON we can render per market. */
const FORMAT_INSTRUCTION = `

Respond with ONLY a valid JSON object (no markdown, no code fences, no commentary) of the exact shape:
{
  "markets": [
    {
      "name": string,            // one of: "Crude Oil WTI", "Gold", "S&P 500", "Bitcoin"
      "bias": string,            // market bias / directional lean
      "support": string,         // key support level(s)
      "resistance": string,      // key resistance level(s)
      "news": string,            // important news / events
      "highRiskPeriods": string, // high-risk trading periods
      "technicalObservations": string,
      "educationalSummary": string
    }
  ],
  "disclaimer": string           // must equal: "${DISCLAIMER}"
}
Include exactly one entry for each of: Crude Oil WTI, Gold, S&P 500, Bitcoin, in that order. Do not give guaranteed buy/sell signals.`;

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
    news: asString(obj["news"]),
    highRiskPeriods: asString(obj["highRiskPeriods"]),
    technicalObservations: asString(obj["technicalObservations"]),
    educationalSummary: asString(obj["educationalSummary"]),
  };
}

export async function generateDailyBrief(log: Logger): Promise<GeneratedBrief> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: BASE_PROMPT + FORMAT_INSTRUCTION }],
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
      news: "Unavailable",
      highRiskPeriods: "Unavailable",
      technicalObservations: "Unavailable",
      educationalSummary: "Data for this market was not returned. Please regenerate the brief.",
    };
  });

  // Hard product requirement: the brief must always carry the exact mandated
  // risk wording. Never trust the model's version — pin it to the canonical string.
  return { markets, disclaimer: DISCLAIMER };
}
