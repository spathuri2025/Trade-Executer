import { getCapitalCandles } from "./capitalcom";
import { routeStrategy } from "./strategyRouter";
import { sma, stdev, adx } from "./indicators";
import { asString, clampInt, generateClaudeJson } from "./aiJson";
import type { CapitalCredentials } from "./brokerCredentialsService";

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
  /**
   * Latest bar volume against the bars before it. Null when the broker reports
   * none. This is CFD volume from Capital.com — activity on their own book, not
   * exchange or futures volume, and the UI says so rather than letting it imply
   * more than it is.
   */
  volume: { latest: number; average: number; ratio: number } | null;
  /**
   * What the user's OWN bot makes of this instrument right now, computed with
   * their configured periods, bar resolution and regime filter.
   *
   * Deliberately not the chart's own 10/30 hourly view: a card saying BUY while
   * the Signals page sits on HOLD is worse than no card at all. Null when the
   * signal could not be computed — not "HOLD", which is a real opinion.
   */
  botSignal: { action: "BUY" | "SELL" | "HOLD"; strategy: string; regime: string | null; resolution: string } | null;
}

/**
 * The latest bar's volume against the bars before it.
 *
 * The comparison is the whole point: a raw figure means nothing without knowing
 * what normal looks like for that instrument. "Drifting lower on volume 40%
 * below average" says the move has little behind it; the same price action on
 * double volume says the opposite.
 *
 * The average deliberately EXCLUDES the latest bar — including it would damp
 * exactly the spike the comparison exists to reveal.
 *
 * Returns null when the broker reports no volume, rather than a zero. Those are
 * different facts: Trading 212 supplies no volume at all, and a genuine
 * zero-volume bar is a real observation about a quiet market.
 */
export function volumeSummary(
  candles: Array<{ volume?: number }>,
  lookback = 20
): { latest: number; average: number; ratio: number } | null {
  if (candles.length < 2) return null;
  const latestRaw = candles[candles.length - 1]?.volume;
  if (typeof latestRaw !== "number" || !Number.isFinite(latestRaw)) return null;

  const prior = candles
    .slice(Math.max(0, candles.length - 1 - lookback), candles.length - 1)
    .map((c) => c.volume)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (prior.length === 0) return null;

  const average = prior.reduce((t, v) => t + v, 0) / prior.length;
  if (!(average > 0)) return null;

  return { latest: latestRaw, average: Math.round(average), ratio: latestRaw / average };
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
  userId: number,
  capitalCredentials: CapitalCredentials,
  epic: string,
  resolution = "HOUR",
  /** The user's live bot settings, so the signal shown is the one their bot acts on. */
  botConfig?: {
    shortPeriod: number;
    longPeriod: number;
    regimeFilterEnabled: boolean;
    barResolution: string;
  } | null,
): Promise<ChartInsight> {
  // Candles rather than closes: identical price series, but they carry the
  // volume the broker already sends and this card was discarding.
  const candles = await getCapitalCandles(userId, capitalCredentials, epic, resolution, 200);
  const prices = candles.map((c) => c.close);
  if (prices.length < 20) {
    throw new Error("Not enough price history to analyse this instrument");
  }
  const volume = volumeSummary(candles);

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

  // What the user's own bot would say, using THEIR settings — not this card's.
  // Computed on the bot's own bar resolution too, so it agrees with the Signals
  // page; that needs a second fetch whenever the chart is showing a different
  // timeframe from the one the engine trades on.
  let botSignal: ChartInsight["botSignal"] = null;
  try {
    const cfg = botConfig ?? null;
    if (cfg) {
      const signalPrices =
        cfg.barResolution === resolution
          ? prices
          : (await getCapitalCandles(userId, capitalCredentials, epic, cfg.barResolution, 200)).map((c) => c.close);
      const routed = routeStrategy(signalPrices, cfg.shortPeriod, cfg.longPeriod, cfg.regimeFilterEnabled);
      if (routed) {
        botSignal = {
          action: routed.signal,
          strategy: routed.strategy,
          regime: routed.regime,
          resolution: cfg.barResolution,
        };
      }
    }
  } catch {
    // A failed signal must not take the whole card down; null reads as
    // "couldn't compute", which the UI states rather than showing HOLD.
  }

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
    volume,
    botSignal,
  };
}
