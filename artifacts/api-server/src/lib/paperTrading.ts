/**
 * Paper trading: what the strategy WOULD have made, measured properly.
 *
 * Dry run used to write an entry row and stop there. Open positions come from
 * the broker, and in dry run the broker has none — so the engine saw an empty
 * book every cycle, treated every signal as a fresh entry, and nothing ever
 * closed. A week of it produced a pile of entries and no profit or loss, which
 * is the one thing dry run exists to tell you.
 *
 * These functions decide when a simulated position would have been closed and
 * what it would have made, so a dry-run week answers the question that matters:
 * does this strategy, on these instruments, at these exits, make money.
 */

export type PaperExitReason = "stop-loss" | "take-profit";

export interface PaperPositionLike {
  side: "BUY" | "SELL";
  entryPrice: number;
  quantity: number;
  /** Price levels, already computed from the configured percentages. Null = not set. */
  stopLevel: number | null;
  targetLevel: number | null;
}

export interface Bar {
  high: number;
  low: number;
}

/**
 * The first exit level a position would have touched, scanning bars in order.
 *
 * Uses each bar's HIGH and LOW rather than its close. A close-only check misses
 * every level touched inside a bar and would report a position as still open
 * when the broker would already have closed it — flattering the result in
 * exactly the direction that matters least to someone deciding whether to risk
 * real money.
 *
 * When one bar touches BOTH levels, the stop is taken. Within a single bar we
 * cannot know which came first, and assuming the profitable one is how paper
 * results end up better than live ones. Pessimistic is the honest default here.
 */
export function resolvePaperExit(
  pos: PaperPositionLike,
  bars: Bar[]
): { reason: PaperExitReason; price: number } | null {
  const long = pos.side === "BUY";

  for (const bar of bars) {
    if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low)) continue;

    const hitStop =
      pos.stopLevel !== null && (long ? bar.low <= pos.stopLevel : bar.high >= pos.stopLevel);
    const hitTarget =
      pos.targetLevel !== null && (long ? bar.high >= pos.targetLevel : bar.low <= pos.targetLevel);

    if (hitStop) return { reason: "stop-loss", price: pos.stopLevel! };
    if (hitTarget) return { reason: "take-profit", price: pos.targetLevel! };
  }
  return null;
}

/**
 * What a simulated position made or lost, in account currency.
 *
 * Deliberately gross: the spread is NOT modelled here, because entry and exit
 * prices come from mid-price bars. Live results will be worse by roughly the
 * spread on every trade — which on this account has ranged from 0.085% to over
 * 0.5%, and on a 3% target is between a twentieth and a fifth of the gain. Any
 * report of these figures has to say so.
 */
export function paperPnl(pos: PaperPositionLike, exitPrice: number): number {
  const move = pos.side === "BUY" ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
  return move * pos.quantity;
}

/** Stop and target prices for a new position, from the configured percentages. */
export function paperLevels(
  side: "BUY" | "SELL",
  entryPrice: number,
  stopLossPercent: number,
  takeProfitPercent: number
): { stopLevel: number | null; targetLevel: number | null } {
  const long = side === "BUY";
  return {
    stopLevel:
      stopLossPercent > 0
        ? long
          ? entryPrice * (1 - stopLossPercent / 100)
          : entryPrice * (1 + stopLossPercent / 100)
        : null,
    targetLevel:
      takeProfitPercent > 0
        ? long
          ? entryPrice * (1 + takeProfitPercent / 100)
          : entryPrice * (1 - takeProfitPercent / 100)
        : null,
  };
}

export interface PaperSummary {
  closed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  averageWin: number | null;
  averageLoss: number | null;
  byReason: { stopLoss: number; takeProfit: number };
}

/** Aggregate closed paper trades, in the same shape the live report uses. */
export function summarisePaper(
  trades: Array<{ pnl: number; exitReason: PaperExitReason | string }>
): PaperSummary {
  const wins = trades.filter((t) => t.pnl > 0).map((t) => t.pnl);
  const losses = trades.filter((t) => t.pnl < 0).map((t) => t.pnl);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  const decided = wins.length + losses.length;

  return {
    closed: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: decided > 0 ? wins.length / decided : null,
    netPnl: round(sum(trades.map((t) => t.pnl))),
    averageWin: wins.length > 0 ? round(sum(wins) / wins.length) : null,
    averageLoss: losses.length > 0 ? round(sum(losses) / losses.length) : null,
    byReason: {
      stopLoss: trades.filter((t) => t.exitReason === "stop-loss").length,
      takeProfit: trades.filter((t) => t.exitReason === "take-profit").length,
    },
  };
}
