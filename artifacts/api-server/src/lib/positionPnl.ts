/**
 * Profit or loss on an open Capital.com position.
 *
 * Until 23 Oct 2026 the app computed (current − entry) × size for EVERY
 * position, ignoring direction, and printed the result with a £ sign. Four
 * OIL_CRUDE shorts losing £6,564.60 at the broker showed on the dashboard as
 * +£8,796 profit — wrong sign, and in dollars labelled as pounds. The Assistant
 * and the AI trader were given the same figures.
 *
 * Two rules now:
 *  - Direction decides the sign, and the price used is the one the position
 *    would actually close at: the bid for a long, the offer for a short.
 *  - The broker's own figure (`upl`) is preferred, because it is what the
 *    broker will settle — but only when it agrees in sign with the price move.
 *    Capital.com does not document its currency; verified on 23 Oct 2026 that
 *    it is the ACCOUNT's (the morning report's −£6,401.06 on four OIL_CRUDE
 *    shorts matched the Capital.com screen). A disagreement in sign means we
 *    cannot trust it, and the computed figure is used instead, labelled in the
 *    instrument's own currency rather than the account's.
 */
export interface CapitalPositionLike {
  direction: "BUY" | "SELL";
  level: number;
  size: number;
  contractSize?: number | null;
  currency?: string | null;
  upl?: number | null;
}

export interface PositionPnl {
  /** The price this position would close at now. */
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  /**
   * The currency `pnl` is in. Null means the account's own currency (the
   * broker's figure); otherwise the instrument's quote currency (computed).
   */
  pnlCurrency: string | null;
  /** The same P&L worked out from prices, in the instrument's quote currency. */
  computedPnl: number;
}

export function capitalPositionPnl(
  pos: CapitalPositionLike,
  market: { bid: number; offer: number }
): PositionPnl {
  const long = pos.direction === "BUY";
  const currentPrice = long ? market.bid : market.offer;
  const sign = long ? 1 : -1;
  const move = (currentPrice - pos.level) * sign;
  const computed = move * pos.size * (pos.contractSize ?? 1);
  const pnlPercent = pos.level > 0 ? (move / pos.level) * 100 : 0;

  const upl = pos.upl;
  const uplAgrees =
    typeof upl === "number" && Number.isFinite(upl) && (computed === 0 || upl === 0 || Math.sign(upl) === Math.sign(computed));

  return uplAgrees
    ? { currentPrice, pnl: upl, pnlPercent, pnlCurrency: null, computedPnl: computed }
    : { currentPrice, pnl: computed, pnlPercent, pnlCurrency: pos.currency ?? null, computedPnl: computed };
}

/**
 * Each position's size × price converted into the ACCOUNT's currency.
 *
 * Capital.com gives prices in the instrument's currency (oil in USD) and the
 * P&L in the account's (GBP) — so each position's own broker P&L divided by
 * the same P&L worked out from prices IS the exchange rate it is being
 * settled at. A position whose rate cannot be read (P&L near zero, just
 * opened) borrows the median rate of others in the same currency; with none,
 * it stays null and nothing is guessed.
 */
export function accountNotionals(
  items: Array<{ notional: number; currency: string | null; pnl: number; pnlCurrency: string | null; computedPnl: number }>
): Array<number | null> {
  const rateOf = (i: (typeof items)[number]): number | null => {
    if (i.pnlCurrency !== null || Math.abs(i.computedPnl) < 1) return null;
    const r = i.pnl / i.computedPnl;
    return Number.isFinite(r) && r > 0.05 && r < 20 ? r : null;
  };
  const byCurrency = new Map<string, number[]>();
  for (const i of items) {
    const r = rateOf(i);
    if (r !== null) byCurrency.set(i.currency ?? "", [...(byCurrency.get(i.currency ?? "") ?? []), r]);
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  return items.map((i) => {
    const own = rateOf(i);
    if (own !== null) return i.notional * own;
    const others = byCurrency.get(i.currency ?? "");
    return others && others.length > 0 ? i.notional * median(others) : null;
  });
}
