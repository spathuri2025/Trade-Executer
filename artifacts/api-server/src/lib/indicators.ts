/**
 * Deterministic technical indicators used by the strategy router and regime
 * filter. Most functions take a plain close-price series (oldest → newest),
 * matching the close-only shape the live broker price-history pipeline
 * provides — where an indicator traditionally needs OHLC data, `adx()` uses a
 * close-based approximation instead, documented at its own definition. `atr()`
 * is the exception: it's the first REAL OHLC-based indicator in this file,
 * only callable where full candles are available (Capital.com's
 * `getBrokerCandles`, not the close-only live pipeline) — currently used only
 * by the backtest-only ATR-momentum strategy, not the live regime router.
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

/**
 * Exponential moving average over `period`, seeded with an SMA of the first
 * `period` values then rolled forward with the standard EMA recurrence.
 * Returns null if there aren't enough values to seed.
 */
export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
  }
  return value;
}

/**
 * Wilder-smoothed Average True Range over high/low/close OHLC arrays (same
 * length, index-aligned, oldest → newest). Unlike `adx()`'s close-based
 * approximation, this is a REAL ATR — it needs true OHLC and is only callable
 * where full candles are available. Returns null if the arrays mismatch in
 * length or there aren't enough bars to seed and smooth over `period`.
 */
export function atr(high: number[], low: number[], close: number[], period: number): number | null {
  if (period <= 0) return null;
  if (high.length !== low.length || high.length !== close.length) return null;
  if (high.length < period + 1) return null;

  const tr: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const range = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
    tr.push(range);
  }
  if (tr.length < period) return null;

  // Wilder smoothing: seed with a simple average of the first `period` true
  // ranges, then roll forward with the standard Wilder recurrence.
  let value = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < tr.length; i++) {
    value = (value * (period - 1) + tr[i]) / period;
  }
  return value;
}
