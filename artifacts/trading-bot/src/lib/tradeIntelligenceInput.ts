import type { Signal, TradeIntelligenceInput } from "@workspace/api-client-react";

/**
 * TradeBuzz doesn't have a full multi-factor scoring engine yet (market
 * structure/liquidity/volume/volatility/sentiment/multi-timeframe/pattern).
 * Until it does, this bridges the deterministic fields a Signal already
 * carries (MA-crossover confidence, regime, AI/news reason) into the shape
 * Claude expects, and honestly marks the rest as not-yet-computed rather
 * than fabricating scores — Claude is instructed to recommend Watchlist/No
 * Trade when the setup is unclear, which is the correct behaviour here.
 */
const NOT_COMPUTED = {
  score: 50,
  direction: "neutral" as const,
  reason: "Not yet computed by TradeBuzz's scoring engine",
};

function directionFromSignal(signal: Signal["signal"]): "bullish" | "bearish" | "neutral" {
  if (signal === "BUY") return "bullish";
  if (signal === "SELL") return "bearish";
  return "neutral";
}

function tradeDirectionLabel(signal: Signal["signal"]): string {
  if (signal === "BUY") return "Long";
  if (signal === "SELL") return "Short";
  return "Neutral";
}

function recommendationFrom(sig: Signal): string {
  switch (sig.suggestedAction) {
    case "Consider":
      return `${sig.signal} Setup`;
    case "Avoid":
    case "Review":
      return "Watchlist";
    default:
      return "No Trade";
  }
}

export function buildTradeIntelligenceInput(sig: Signal): TradeIntelligenceInput {
  const trendDirection = directionFromSignal(sig.signal);

  return {
    symbol: sig.ticker,
    // The bot currently evaluates a single interval, so there's nothing
    // real to report per-timeframe yet.
    timeframes: [],
    factorScores: {
      trend: {
        score: sig.confidence ?? 50,
        direction: trendDirection,
        reason: sig.technicalReason ?? "No technical detail available",
      },
      marketStructure: sig.regime
        ? {
            score: sig.regime === "trending" ? 65 : 40,
            direction: sig.regime === "trending" ? trendDirection : "neutral",
            reason: `Regime classified as ${sig.regime}`,
          }
        : NOT_COMPUTED,
      news:
        sig.newsReason ?? sig.aiReason
          ? {
              score: 55,
              direction: "neutral",
              reason: (sig.newsReason ?? sig.aiReason) as string,
            }
          : { ...NOT_COMPUTED, reason: "No news signal available for this cycle" },
      liquidity: NOT_COMPUTED,
      volume: NOT_COMPUTED,
      volatility: NOT_COMPUTED,
      sentiment: NOT_COMPUTED,
      multiTimeframe: {
        ...NOT_COMPUTED,
        reason: "TradeBuzz currently evaluates a single timeframe (bot interval); multi-timeframe scoring not yet implemented",
      },
      pattern: NOT_COMPUTED,
    },
    riskPlan: {
      entryZone: sig.price.toFixed(2),
      stopLoss: "Not available — configure risk settings for a live risk plan",
      takeProfit1: "Not available — configure risk settings for a live risk plan",
      takeProfit2: "Not available — configure risk settings for a live risk plan",
      riskRewardRatio: "Not available — configure risk settings for a live risk plan",
    },
    finalScore: sig.confidence ?? 50,
    direction: tradeDirectionLabel(sig.signal),
    recommendation: recommendationFrom(sig),
  };
}
