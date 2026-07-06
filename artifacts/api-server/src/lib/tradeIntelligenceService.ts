import { asString, asStringArray, generateClaudeJson } from "./aiJson";

export const TRADE_INTELLIGENCE_DISCLAIMER =
  "TradeBuzz provides market analysis and educational information only. This is not financial advice. Trading involves risk.";

export interface TradeFactorScoreInput {
  score: number;
  direction: "bullish" | "bearish" | "neutral";
  reason: string;
}

export interface TradeIntelligenceEvaluateInput {
  symbol: string;
  timeframes: string[];
  factorScores: Record<
    | "trend"
    | "marketStructure"
    | "liquidity"
    | "volume"
    | "volatility"
    | "news"
    | "sentiment"
    | "multiTimeframe"
    | "pattern",
    TradeFactorScoreInput
  >;
  riskPlan: {
    entryZone?: string;
    stopLoss?: string;
    takeProfit1?: string;
    takeProfit2?: string;
    riskRewardRatio?: string;
  };
  finalScore: number;
  direction: string;
  recommendation: string;
}

export interface TradeIntelligenceReport {
  summary: string;
  bullishFactors: string[];
  bearishFactors: string[];
  warnings: string[];
  tradeNarrative: string;
  beginnerExplanation: string;
  advancedExplanation: string;
  finalRecommendation: string;
  invalidationReason: string;
  riskWarning: string;
  disclaimer: string;
}

const SYSTEM_INSTRUCTIONS =
  "You are TradeBuzz AI Brain. You analyse trading setups for educational purposes only. You do not provide financial advice. You must not invent market prices, live news, or unsupported claims. Use only the data provided. If the setup is unclear, recommend Watchlist or No Trade.";

const FORMAT = `

Respond with ONLY a valid JSON object (no markdown, no code fences, no commentary) of the exact shape:
{
  "summary": string,                 // 1-2 sentences, plain language, the headline read on this setup
  "bullishFactors": string[],        // short phrases pulled from factors with a bullish direction, empty array if none
  "bearishFactors": string[],        // short phrases pulled from factors with a bearish direction, empty array if none
  "warnings": string[],              // short phrases flagging weak/neutral/missing factors or conflicting signals, empty array if none
  "tradeNarrative": string,          // 2-4 sentences telling the story of the setup using only the given factors
  "beginnerExplanation": string,     // 2-3 plain-language sentences a first-time trader could follow, no jargon
  "advancedExplanation": string,     // 2-3 sentences using precise technical language for an experienced trader
  "finalRecommendation": string,     // e.g. "Buy Setup", "Sell Setup", "Watchlist", "No Trade" — default to Watchlist or No Trade if the setup is unclear
  "invalidationReason": string,      // what would prove this setup wrong (a level, factor flip, or condition)
  "riskWarning": string              // must equal: "${TRADE_INTELLIGENCE_DISCLAIMER}"
}
Do not invent prices, news, or data beyond what is given below.`;

function formatFactor(name: string, f: TradeFactorScoreInput): string {
  return `- ${name}: score ${f.score}/100, direction ${f.direction}, reason: ${f.reason}`;
}

function buildPrompt(input: TradeIntelligenceEvaluateInput): string {
  const factorLines = (Object.entries(input.factorScores) as [string, TradeFactorScoreInput][]).map(
    ([name, f]) => formatFactor(name, f),
  );

  const riskLines = [
    input.riskPlan.entryZone ? `Entry zone: ${input.riskPlan.entryZone}` : "",
    input.riskPlan.stopLoss ? `Stop loss: ${input.riskPlan.stopLoss}` : "",
    input.riskPlan.takeProfit1 ? `Take profit 1: ${input.riskPlan.takeProfit1}` : "",
    input.riskPlan.takeProfit2 ? `Take profit 2: ${input.riskPlan.takeProfit2}` : "",
    input.riskPlan.riskRewardRatio ? `Risk/reward ratio: ${input.riskPlan.riskRewardRatio}` : "",
  ].filter(Boolean);

  return [
    SYSTEM_INSTRUCTIONS,
    "",
    `Symbol: ${input.symbol}`,
    input.timeframes.length > 0 ? `Timeframes analysed: ${input.timeframes.join(", ")}` : "",
    "",
    "Factor scores:",
    ...factorLines,
    "",
    riskLines.length > 0 ? "Risk plan:" : "",
    ...riskLines,
    "",
    `TradeBuzz final score: ${input.finalScore}/100`,
    `TradeBuzz direction: ${input.direction}`,
    `TradeBuzz recommendation: ${input.recommendation}`,
    FORMAT,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function evaluateTradeIntelligence(
  input: TradeIntelligenceEvaluateInput,
): Promise<TradeIntelligenceReport> {
  const parsed = await generateClaudeJson(buildPrompt(input), { maxTokens: 2048 });

  return {
    summary: asString(parsed["summary"]),
    bullishFactors: asStringArray(parsed["bullishFactors"]).slice(0, 6),
    bearishFactors: asStringArray(parsed["bearishFactors"]).slice(0, 6),
    warnings: asStringArray(parsed["warnings"]).slice(0, 6),
    tradeNarrative: asString(parsed["tradeNarrative"]),
    beginnerExplanation: asString(parsed["beginnerExplanation"]),
    advancedExplanation: asString(parsed["advancedExplanation"]),
    finalRecommendation: asString(parsed["finalRecommendation"]),
    invalidationReason: asString(parsed["invalidationReason"]),
    // Hard product requirement — pin the mandated wording, never trust the model's.
    riskWarning: TRADE_INTELLIGENCE_DISCLAIMER,
    disclaimer: TRADE_INTELLIGENCE_DISCLAIMER,
  };
}
