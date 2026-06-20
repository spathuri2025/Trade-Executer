export function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

export interface MASignal {
  signal: "BUY" | "SELL" | "HOLD";
  shortMa: number;
  longMa: number;
}

export function computeMASignal(
  prices: number[],
  shortPeriod: number,
  longPeriod: number
): MASignal | null {
  if (prices.length < longPeriod + 1) return null;

  const shortNow = calculateSMA(prices, shortPeriod);
  const longNow = calculateSMA(prices, longPeriod);

  const prevPrices = prices.slice(0, -1);
  const shortPrev = calculateSMA(prevPrices, shortPeriod);
  const longPrev = calculateSMA(prevPrices, longPeriod);

  if (shortNow == null || longNow == null || shortPrev == null || longPrev == null) return null;

  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";

  if (shortPrev <= longPrev && shortNow > longNow) {
    signal = "BUY";
  } else if (shortPrev >= longPrev && shortNow < longNow) {
    signal = "SELL";
  }

  return { signal, shortMa: shortNow, longMa: longNow };
}
