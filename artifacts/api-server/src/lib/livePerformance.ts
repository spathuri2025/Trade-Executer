/**
 * Real trading results, computed from the broker's own transaction history.
 *
 * Why the broker and not our `trades` table: most closes never pass through the
 * bot. A take-profit or stop-loss fires at Capital.com, and a manual close
 * happens in their app — neither leaves a row here. Judging the bot from our own
 * table would count every entry and miss most exits, and until this existed the
 * only honest record was a phone screenshot of Capital.com's history.
 *
 * Row shape, from Capital.com's own API example:
 *   { date, dateUtc: "2022-04-04T16:51:05.648", instrumentName: "US500",
 *     transactionType: "TRADE", note: "Trade closed", reference, size: "1.05",
 *     currency: "USD" }
 *
 * `size` on a TRADE row is realised profit or loss, and it already includes the
 * spread — a position is opened at the offer and closed at the bid, so the cost
 * is inside the price. Overnight funding (SWAP) and commissions are separate
 * rows, and are included in the net result so nothing flatters the headline.
 */

export interface BrokerTransaction {
  dateUtc: string;
  instrumentName: string;
  transactionType: string;
  note: string;
  size: string;
  currency: string;
}

export type CloseType = "take-profit" | "stop-loss" | "closed";

export interface LivePerformance {
  currency: string | null;
  closedTrades: number;
  wins: number;
  losses: number;
  /** Wins as a share of wins + losses; a trade closed at exactly zero counts for neither. */
  winRate: number | null;
  averageWin: number | null;
  /** Negative. */
  averageLoss: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  /** Total won ÷ total lost. Above 1 means winners outweighed losers. null with no losses. */
  profitFactor: number | null;
  /** Sum of realised trade results, spread included. */
  tradingResult: number;
  /** Overnight funding charged (negative) or credited. */
  funding: number;
  /** Commissions and fees. */
  fees: number;
  /** tradingResult + funding + fees: what the account actually made. */
  netResult: number;
  /** netResult ÷ closedTrades. */
  averagePerTrade: number | null;
  /** Days on which at least one trade closed. */
  tradingDays: number;
  /** netResult ÷ tradingDays. */
  averagePerTradingDay: number | null;
  byDay: Array<{ date: string; net: number; trades: number }>;
  byInstrument: Array<{ instrumentName: string; trades: number; net: number }>;
  recentTrades: Array<{ dateUtc: string; instrumentName: string; result: number; closeType: CloseType }>;
  /**
   * How trades ended, counted over the whole period.
   *
   * The question this answers: are the exit levels doing anything? On 24 Sep
   * 2026 the average trade realised £0.21 on a £250 position — a 0.084% move,
   * against a 1.5% stop and a 3% target. Either the targets are never reached
   * or something closes positions long before them, and those are very
   * different problems. Capital.com labels every close, so the answer was
   * already in the data and simply never counted.
   */
  exits: { takeProfit: number; stopLoss: number; closedEarly: number };
}

const FEE_TYPES = new Set(["TRADE_COMMISSION", "TRADE_COMMISSION_GSL", "FX_COMMISSION", "INACTIVITY_FEE"]);

/** Capital.com's dateUtc has no zone suffix; it is UTC by name. */
export function parseUtc(dateUtc: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(dateUtc) ? dateUtc : `${dateUtc}Z`);
}

export function closeTypeFromNote(note: string): CloseType {
  if (/take[\s-]*profit/i.test(note)) return "take-profit";
  if (/stop[\s-]*loss/i.test(note)) return "stop-loss";
  return "closed";
}

const round = (n: number) => Math.round(n * 100) / 100;

export function summariseTransactions(rows: BrokerTransaction[]): LivePerformance {
  const trades: Array<{ dateUtc: string; instrumentName: string; result: number; closeType: CloseType }> = [];
  let funding = 0;
  let fees = 0;
  const dayNet = new Map<string, { net: number; trades: number }>();
  const instrumentNet = new Map<string, { trades: number; net: number }>();

  const addDay = (dateUtc: string, amount: number, isTrade: boolean) => {
    const key = parseUtc(dateUtc).toISOString().slice(0, 10);
    const d = dayNet.get(key) ?? { net: 0, trades: 0 };
    d.net += amount;
    if (isTrade) d.trades += 1;
    dayNet.set(key, d);
  };
  const addInstrument = (name: string, amount: number, isTrade: boolean) => {
    const i = instrumentNet.get(name) ?? { trades: 0, net: 0 };
    i.net += amount;
    if (isTrade) i.trades += 1;
    instrumentNet.set(name, i);
  };

  for (const row of rows) {
    const amount = Number(row.size);
    if (!Number.isFinite(amount)) continue;

    if (row.transactionType === "TRADE") {
      // An opening leg carries no realised result; only closes are trades here.
      if (/open/i.test(row.note)) continue;
      trades.push({
        dateUtc: row.dateUtc,
        instrumentName: row.instrumentName,
        result: amount,
        closeType: closeTypeFromNote(row.note),
      });
      addDay(row.dateUtc, amount, true);
      addInstrument(row.instrumentName, amount, true);
    } else if (row.transactionType === "SWAP") {
      funding += amount;
      addDay(row.dateUtc, amount, false);
      addInstrument(row.instrumentName, amount, false);
    } else if (FEE_TYPES.has(row.transactionType)) {
      fees += amount;
      addDay(row.dateUtc, amount, false);
    }
    // Deposits, withdrawals, transfers and adjustments are not trading
    // performance and are deliberately left out.
  }

  const exits = { takeProfit: 0, stopLoss: 0, closedEarly: 0 };
  for (const t of trades) {
    if (t.closeType === "take-profit") exits.takeProfit += 1;
    else if (t.closeType === "stop-loss") exits.stopLoss += 1;
    else exits.closedEarly += 1;
  }

  const winners = trades.filter((t) => t.result > 0).map((t) => t.result);
  const losers = trades.filter((t) => t.result < 0).map((t) => t.result);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const tradingResult = sum(trades.map((t) => t.result));
  const netResult = tradingResult + funding + fees;
  const tradingDays = [...dayNet.values()].filter((d) => d.trades > 0).length;
  const decided = winners.length + losers.length;

  return {
    currency: rows.find((r) => r.currency)?.currency ?? null,
    closedTrades: trades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: decided > 0 ? winners.length / decided : null,
    averageWin: winners.length ? round(sum(winners) / winners.length) : null,
    averageLoss: losers.length ? round(sum(losers) / losers.length) : null,
    largestWin: winners.length ? round(Math.max(...winners)) : null,
    largestLoss: losers.length ? round(Math.min(...losers)) : null,
    profitFactor: losers.length ? round(sum(winners) / Math.abs(sum(losers))) : null,
    tradingResult: round(tradingResult),
    funding: round(funding),
    fees: round(fees),
    netResult: round(netResult),
    averagePerTrade: trades.length ? round(netResult / trades.length) : null,
    tradingDays,
    averagePerTradingDay: tradingDays ? round(netResult / tradingDays) : null,
    byDay: [...dayNet.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, d]) => ({ date, net: round(d.net), trades: d.trades })),
    byInstrument: [...instrumentNet.entries()]
      .map(([instrumentName, i]) => ({ instrumentName, trades: i.trades, net: round(i.net) }))
      .sort((a, b) => a.net - b.net),
    exits,
    recentTrades: [...trades]
      .sort((a, b) => parseUtc(b.dateUtc).getTime() - parseUtc(a.dateUtc).getTime())
      .slice(0, 50)
      .map((t) => ({ ...t, result: round(t.result) })),
  };
}
