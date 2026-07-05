import {
  asString,
  asStringArray,
  generateClaudeJson,
  oneOf,
} from "./aiJson";

export const NEWS_DISCLAIMER = "AI-generated market commentary. Not financial advice.";

export interface NewsAnalysisInput {
  headline: string;
  articleText?: string;
  source?: string;
  timestamp?: string;
}

export interface NewsAnalysis {
  affectedAssets: string[];
  sentiment: "bullish" | "bearish" | "neutral";
  impactLevel: "low" | "medium" | "high";
  summary: string;
  whyItMatters: string;
  possibleReaction: string;
  riskWarning: string;
}

const PROMPT_HEAD =
  "You are the TradeBuzz Market News Analyst. Read the news item below and assess its likely effect on tradable markets (indices, forex, commodities, crypto, major stocks). Be concise, plain-language and neutral. Do NOT give buy/sell advice. Focus on the assets most affected and the realistic short-term market reaction.";

const FORMAT = `

Respond with ONLY a valid JSON object (no markdown, no code fences, no commentary) of the exact shape:
{
  "affectedAssets": string[],          // e.g. ["Gold","S&P 500","USD"] — 1 to 5 items, tickers or asset names
  "sentiment": "bullish"|"bearish"|"neutral",  // net directional lean for the affected assets
  "impactLevel": "low"|"medium"|"high",        // how market-moving this is
  "summary": string,                   // 1-2 short sentences, plain language
  "whyItMatters": string,              // 1-2 short sentences on the significance
  "possibleReaction": string,          // 1-2 short sentences on the likely short-term market reaction
  "riskWarning": string                // must equal: "${NEWS_DISCLAIMER}"
}
Keep every field concise. Do not invent specific price levels.`;

export async function analyseNews(input: NewsAnalysisInput): Promise<NewsAnalysis> {
  const parts = [
    PROMPT_HEAD,
    "",
    `Headline: ${input.headline}`,
    input.source ? `Source: ${input.source}` : "",
    input.timestamp ? `Published: ${input.timestamp}` : "",
    input.articleText ? `\nArticle text:\n${input.articleText.slice(0, 4000)}` : "",
    FORMAT,
  ].filter(Boolean);

  const parsed = await generateClaudeJson(parts.join("\n"));

  return {
    affectedAssets: asStringArray(parsed["affectedAssets"]).slice(0, 5),
    sentiment: oneOf(parsed["sentiment"], ["bullish", "bearish", "neutral"] as const, "neutral"),
    impactLevel: oneOf(parsed["impactLevel"], ["low", "medium", "high"] as const, "medium"),
    summary: asString(parsed["summary"]),
    whyItMatters: asString(parsed["whyItMatters"]),
    possibleReaction: asString(parsed["possibleReaction"]),
    // Hard product requirement — pin the mandated wording, never trust the model's.
    riskWarning: NEWS_DISCLAIMER,
  };
}
