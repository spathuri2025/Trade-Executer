import { getCapitalPriceHistory } from "./capitalcom";
import { sma, stdev, adx } from "./indicators";
import { asString, clampInt, generateClaudeJson } from "./aiJson";

export const CHART_DISCLAIMER =
  "AI-generated technical read. Not financial advice. Markets can move against any setup.";

export type TrendDirection = "Uptrend" | "Downtrend" | "Sideways";
export type VolatilityLevel = "Low" | "Medium" | "High";

export interface ChartInsight {
  epic: string;
  trend: TrendDirection;
  support: number | null;
  resistance: number | null;
  volatility: VolatilityLevel;
  confidence: number;
  explanation: string;
  riskWarning: string;
}

function roundPrice(n: number): number {
  const abs = Math.abs(n);
  const decimals = abs >= 1000 ? 1 : abs >= 1 ? 2 : 5;
  return Number(n.toFixed(decimals));
}

/**
 * Computes a technical read for an instrument. Trend / support / resistance /
 * volatility / confidence are all DETERMINISTIC (from the close series) so the
 * numbers never depend on an LLM. Claude only writes the short plain-language
 * explanation; if that call fails we fall back to a templated sentence.
 */
export async function computeChartInsight(
  epic: string,
  resolution = "HOUR",
): Promise<ChartInsight> {
  const prices = await getCapitalPriceHistory(epic, resolution, 200);
  if (prices.length < 20) {
    throw new Error("Not enough price history to analyse this instrument");
  }

  const last = prices[prices.length - 1];
  const shortMa = sma(prices, 10) ?? last;
  const longMa = sma(prices, 30) ?? last;

  let trend: TrendDirection;
  const gap = (shortMa - longMa) / (longMa || 1);
  if (gap > 0.001) trend = "Uptrend";
  else if (gap < -0.001) trend = "Downtrend";
  else trend = "Sideways";

  const window = prices.slice(-40);
  const support = roundPrice(Math.min(...window));
  const resistance = roundPrice(Math.max(...window));

  const sd = stdev(prices, 20) ?? 0;
  const volPct = last ? (sd / last) * 100 : 0;
  let volatility: VolatilityLevel;
  if (volPct < 1) volatility = "Low";
  else if (volPct < 2.5) volatility = "Medium";
  else volatility = "High";

  const adxVal = adx(prices, 14);
  const confidence = clampInt((adxVal ?? 15) * 2.2, 5, 95);

  let explanation = `Price is in a ${trend.toLowerCase()} with ${volatility.toLowerCase()} volatility, trading near ${roundPrice(last)} between support ${support} and resistance ${resistance}.`;
  try {
    const parsed = await generateClaudeJson(
      `You are a plain-language trading coach. Explain this technical read in ONE short sentence a beginner understands. Do NOT give buy/sell advice.
Instrument: ${epic}
Trend: ${trend}
Last price: ${roundPrice(last)}
Support: ${support}
Resistance: ${resistance}
Volatility: ${volatility}
Trend-strength confidence: ${confidence}/100

Respond with ONLY JSON: { "explanation": string }  // one short sentence, plain language, no advice`,
      { maxTokens: 300 },
    );
    const aiText = asString(parsed["explanation"]);
    if (aiText) explanation = aiText;
  } catch {
    // Keep the deterministic templated explanation.
  }

  return {
    epic,
    trend,
    support,
    resistance,
    volatility,
    confidence,
    explanation,
    riskWarning: CHART_DISCLAIMER,
  };
}
