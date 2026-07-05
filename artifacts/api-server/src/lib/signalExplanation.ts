import type { Signal } from "@workspace/db";

/**
 * Deterministically derives a richer, plain-language explanation for a stored
 * signal from the fields we already persist (signal, MAs, price, strategy,
 * regime, AI reason). No new DB columns and no LLM call — this keeps the Signals
 * page fast and always populated.
 */

export type RiskLevel = "Low" | "Medium" | "High";
export type SuggestedAction = "Watch" | "Avoid" | "Consider" | "Review";

export interface SignalExplanation {
  signalReason: string;
  confidence: number;
  technicalReason: string;
  newsReason: string | null;
  riskLevel: RiskLevel;
  suggestedAction: SuggestedAction;
}

function maGapPercent(shortMa: number, longMa: number): number {
  if (!longMa) return 0;
  return ((shortMa - longMa) / longMa) * 100;
}

export function deriveSignalExplanation(s: Signal): SignalExplanation {
  const shortMa = Number(s.shortMa);
  const longMa = Number(s.longMa);
  const gapPct = maGapPercent(shortMa, longMa);
  const absGap = Math.abs(gapPct);

  // Confidence: how decisively the short MA has separated from the long MA,
  // scaled to a friendly 0-100. A HOLD sits low by construction.
  let confidence: number;
  if (s.signal === "HOLD") {
    confidence = Math.max(10, Math.min(45, Math.round(50 - absGap * 10)));
  } else {
    confidence = Math.max(35, Math.min(95, Math.round(45 + absGap * 25)));
  }

  const dir = s.signal === "BUY" ? "above" : s.signal === "SELL" ? "below" : "close to";
  const technicalReason =
    s.signal === "HOLD"
      ? `Short-term average (${shortMa}) is ${dir} the long-term average (${longMa}); no clear crossover yet.`
      : `Short-term average (${shortMa}) crossed ${dir} the long-term average (${longMa}) — a ${s.signal === "BUY" ? "bullish" : "bearish"} moving-average crossover (${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(2)}% gap).`;

  const regimeNote = s.regime
    ? ` Market looks ${s.regime}.`
    : "";
  const signalReason =
    s.signal === "HOLD"
      ? `No trade. The trend isn't decisive enough to act on right now.${regimeNote}`
      : `${s.signal} signal from the moving-average crossover strategy.${regimeNote}`;

  // Risk level from decisiveness + regime.
  let riskLevel: RiskLevel;
  if (s.regime === "ranging" && s.signal !== "HOLD") riskLevel = "High";
  else if (absGap < 0.5) riskLevel = "High";
  else if (absGap < 1.5) riskLevel = "Medium";
  else riskLevel = "Low";

  let suggestedAction: SuggestedAction;
  if (s.signal === "HOLD") suggestedAction = "Watch";
  else if (riskLevel === "High") suggestedAction = "Avoid";
  else if (riskLevel === "Medium") suggestedAction = "Review";
  else suggestedAction = "Consider";

  const newsReason = s.aiReason && s.aiReason.trim().length > 0 ? s.aiReason.trim() : null;

  return {
    signalReason,
    confidence,
    technicalReason,
    newsReason,
    riskLevel,
    suggestedAction,
  };
}
