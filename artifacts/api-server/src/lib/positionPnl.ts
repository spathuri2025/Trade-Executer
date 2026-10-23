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
 *    Its currency is not documented, so a disagreement means we cannot trust
 *    it and the computed figure is used instead, labelled in the instrument's
 *    own currency rather than the account's.
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
    ? { currentPrice, pnl: upl, pnlPercent, pnlCurrency: null }
    : { currentPrice, pnl: computed, pnlPercent, pnlCurrency: pos.currency ?? null };
}
