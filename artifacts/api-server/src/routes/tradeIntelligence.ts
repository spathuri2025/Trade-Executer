import { Router, type IRouter } from "express";
import {
  evaluateTradeIntelligence,
  type TradeFactorScoreInput,
  type TradeIntelligenceEvaluateInput,
} from "../lib/tradeIntelligenceService";

const router: IRouter = Router();

const FACTOR_KEYS = [
  "trend",
  "marketStructure",
  "liquidity",
  "volume",
  "volatility",
  "news",
  "sentiment",
  "multiTimeframe",
  "pattern",
] as const;

const DIRECTIONS = new Set(["bullish", "bearish", "neutral"]);

function parseFactor(value: unknown): TradeFactorScoreInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const score = Number(v["score"]);
  const direction = v["direction"];
  const reason = v["reason"];
  if (!Number.isFinite(score) || typeof direction !== "string" || !DIRECTIONS.has(direction)) {
    return null;
  }
  return {
    score,
    direction: direction as TradeFactorScoreInput["direction"],
    reason: typeof reason === "string" ? reason : "",
  };
}

router.post("/trade-intelligence/evaluate-with-claude", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const symbol = typeof body["symbol"] === "string" ? body["symbol"].trim() : "";
  if (!symbol) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }

  const rawFactorScores = body["factorScores"];
  if (typeof rawFactorScores !== "object" || rawFactorScores === null) {
    res.status(400).json({ error: "factorScores is required" });
    return;
  }
  const factorScoresInput = rawFactorScores as Record<string, unknown>;

  const factorScores: Partial<TradeIntelligenceEvaluateInput["factorScores"]> = {};
  for (const key of FACTOR_KEYS) {
    const parsed = parseFactor(factorScoresInput[key]);
    if (!parsed) {
      res.status(400).json({ error: `factorScores.${key} is missing or malformed` });
      return;
    }
    factorScores[key] = parsed;
  }

  const finalScore = Number(body["finalScore"]);
  if (!Number.isFinite(finalScore)) {
    res.status(400).json({ error: "finalScore is required" });
    return;
  }

  const direction = typeof body["direction"] === "string" ? body["direction"] : "";
  const recommendation = typeof body["recommendation"] === "string" ? body["recommendation"] : "";
  if (!direction || !recommendation) {
    res.status(400).json({ error: "direction and recommendation are required" });
    return;
  }

  const timeframes = Array.isArray(body["timeframes"])
    ? body["timeframes"].filter((t): t is string => typeof t === "string")
    : [];

  const rawRiskPlan = (body["riskPlan"] ?? {}) as Record<string, unknown>;
  const riskPlan = {
    entryZone: typeof rawRiskPlan["entryZone"] === "string" ? rawRiskPlan["entryZone"] : undefined,
    stopLoss: typeof rawRiskPlan["stopLoss"] === "string" ? rawRiskPlan["stopLoss"] : undefined,
    takeProfit1: typeof rawRiskPlan["takeProfit1"] === "string" ? rawRiskPlan["takeProfit1"] : undefined,
    takeProfit2: typeof rawRiskPlan["takeProfit2"] === "string" ? rawRiskPlan["takeProfit2"] : undefined,
    riskRewardRatio:
      typeof rawRiskPlan["riskRewardRatio"] === "string" ? rawRiskPlan["riskRewardRatio"] : undefined,
  };

  try {
    const report = await evaluateTradeIntelligence({
      symbol,
      timeframes,
      factorScores: factorScores as TradeIntelligenceEvaluateInput["factorScores"],
      riskPlan,
      finalScore,
      direction,
      recommendation,
    });
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to evaluate trade intelligence");
    res.status(502).json({ error: "Failed to generate AI trade intelligence" });
  }
});

export default router;
