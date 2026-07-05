import { db, instrumentsTable } from "@workspace/db";
import type {
  BrainDriver,
  BrainEvent,
  BrainOpportunity,
  BrainRisk,
} from "@workspace/db";
import { getMarketNews } from "./newsService";
import { asString, clampInt, generateClaudeJson, oneOf } from "./aiJson";

export const BRAIN_DISCLAIMER =
  "AI-generated market commentary. Not financial advice. Trading involves substantial risk.";

export type MarketRegime = "Risk-On" | "Risk-Off" | "Mixed" | "High Volatility";

export interface GeneratedBrain {
  regime: MarketRegime;
  confidence: number;
  drivers: BrainDriver[];
  highImpactNewsCount: number;
  upcomingEvents: BrainEvent[];
  opportunities: BrainOpportunity[];
  risks: BrainRisk[];
  disclaimer: string;
}

const REGIMES: readonly MarketRegime[] = ["Risk-On", "Risk-Off", "Mixed", "High Volatility"];

function normList<T>(value: unknown, map: (o: Record<string, unknown>) => T, max: number): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map(map)
    .slice(0, max);
}

export async function generateMarketBrain(): Promise<GeneratedBrain> {
  const news = await getMarketNews(20);
  const highImpactNewsCount = news.filter((n) => n.impactLabel === "HIGH").length;

  const instruments = await db.select().from(instrumentsTable);
  const watchlist = instruments
    .filter((i) => i.enabled)
    .map((i) => `${i.ticker} (${i.name})`)
    .join(", ");

  const headlines = news
    .slice(0, 15)
    .map((n, i) => `${i + 1}. [${n.impactLabel}] ${n.title} — ${n.source}`)
    .join("\n");

  const prompt = `You are the TradeBuzz "AI Market Brain". Using the recent market news and the user's watchlist below, produce a concise top-of-dashboard market intelligence snapshot for a non-expert day trader. Be neutral and plain-language. Do NOT give guaranteed buy/sell signals. Base the regime and drivers on the news; if news is thin, say the picture is unclear and lower the confidence.

Recent market news (most impactful first):
${headlines || "(no fresh news available)"}

User watchlist: ${watchlist || "(empty)"}
High-impact news count today: ${highImpactNewsCount}

Respond with ONLY a valid JSON object (no markdown, no code fences, no commentary) of the exact shape:
{
  "regime": "Risk-On"|"Risk-Off"|"Mixed"|"High Volatility",
  "confidence": number,               // 0-100, your confidence in this read
  "drivers": [ { "title": string, "detail": string } ],        // 2-4 top market drivers today
  "upcomingEvents": [ { "name": string, "when": string, "importance": "low"|"medium"|"high" } ], // 0-4 known scheduled events (e.g. CPI, FOMC); [] if none known
  "opportunities": [ { "asset": string, "rationale": string } ], // 1-3, prefer watchlist assets
  "risks": [ { "title": string, "detail": string } ]           // 1-3 main risks today
}
Keep every string short (max ~20 words). Do not invent specific price levels.`;

  const parsed = await generateClaudeJson(prompt, { maxTokens: 3072 });

  return {
    regime: oneOf(parsed["regime"], REGIMES, "Mixed"),
    confidence: clampInt(Number(parsed["confidence"]), 0, 100),
    drivers: normList<BrainDriver>(
      parsed["drivers"],
      (o) => ({ title: asString(o["title"]), detail: asString(o["detail"]) }),
      4,
    ),
    highImpactNewsCount,
    upcomingEvents: normList<BrainEvent>(
      parsed["upcomingEvents"],
      (o) => ({
        name: asString(o["name"]),
        when: asString(o["when"]),
        importance: oneOf(o["importance"], ["low", "medium", "high"] as const, "medium"),
      }),
      4,
    ),
    opportunities: normList<BrainOpportunity>(
      parsed["opportunities"],
      (o) => ({ asset: asString(o["asset"]), rationale: asString(o["rationale"]) }),
      3,
    ),
    risks: normList<BrainRisk>(
      parsed["risks"],
      (o) => ({ title: asString(o["title"]), detail: asString(o["detail"]) }),
      3,
    ),
    disclaimer: BRAIN_DISCLAIMER,
  };
}
