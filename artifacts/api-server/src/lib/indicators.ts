/**
 * Deterministic technical indicators used by the strategy router and regime
 * filter. All functions take a plain close-price series (oldest → newest), which
 * is the only price shape the broker price-history pipeline provides. Where an
 * indicator traditionally needs OHLC data (ADX/ATR), a close-based approximation
 * is used and documented — this keeps strategy routing dependency-free and never
 * reliant on an LLM call.
 */

/** Simple moving average of the last `period` values, or null if too few. */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/** Population standard deviation of the last `period` values. */
export function stdev(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

/**
 * Wilder's RSI over `period`. Returns 0–100, or null if there is not enough
 * data. > overbought suggests stretched to the upside, < oversold to the down.
 */
export function rsi(prices: number[], period: number): number | null {
  if (period <= 0 || prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  // Seed with the first `period` changes.
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder smoothing over the remaining changes.
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface BollingerBands {
  middle: number;
  upper: number;
  lower: number;
}

/** Bollinger Bands (SMA ± mult·stdev) over `period`. */
export function bollingerBands(
  prices: number[],
  period: number,
  mult: number
): BollingerBands | null {
  const middle = sma(prices, period);
  const sd = stdev(prices, period);
  if (middle == null || sd == null) return null;
  return { middle, upper: middle + mult * sd, lower: middle - mult * sd };
}

/**
 * Close-based ADX approximation over `period`. Real ADX uses OHLC; with only
 * closes available we treat each bar's true range as the absolute close-to-close
 * change and derive directional movement from the sign of that change, then apply
 * Wilder smoothing. The result tracks trend strength well enough for a regime
 * gate (high ADX = trending, low = ranging). Returns null if data is too short.
 */
export function adx(prices: number[], period: number): number | null {
  if (period <= 0 || prices.length < period * 2 + 1) return null;

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    tr.push(Math.abs(change));
    plusDM.push(change > 0 ? change : 0);
    minusDM.push(change < 0 ? -change : 0);
  }

  // Wilder-smoothed running sums.
  const wilder = (arr: number[]): number[] => {
    const out: number[] = [];
    let sum = arr.slice(0, period).reduce((s, v) => s + v, 0);
    out.push(sum);
    for (let i = period; i < arr.length; i++) {
      sum = sum - sum / period + arr[i];
      out.push(sum);
    }
    return out;
  };

  const trS = wilder(tr);
  const plusS = wilder(plusDM);
  const minusS = wilder(minusDM);

  const dx: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    const trv = trS[i];
    if (trv === 0) {
      dx.push(0);
      continue;
    }
    const plusDI = (100 * plusS[i]) / trv;
    const minusDI = (100 * minusS[i]) / trv;
    const denom = plusDI + minusDI;
    dx.push(denom === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / denom);
  }

  if (dx.length < period) return null;
  // ADX is the Wilder average of DX; use the final smoothed value.
  let adxVal = dx.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
  }
  return adxVal;
}
