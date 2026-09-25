import { summariseTransactions, parseUtc, type BrokerTransaction } from "./livePerformance";

/**
 * The morning report: what the account actually did, from the broker's own
 * records rather than the bot's log — take-profits, stop-losses and anything
 * closed by hand all happen at the broker and never pass through the engine.
 *
 * Deliberately just the numbers. No encouragement, no interpretation beyond
 * one line about whether there are yet enough trades to mean anything: a
 * summary that flatters is worse than none, and this exists so decisions rest
 * on evidence rather than on how a day felt.
 */

/** Below this many closed trades, a win rate is noise. */
const MEANINGFUL_SAMPLE = 50;

export interface DailyReport {
  subject: string;
  text: string;
  /** For the in-app copy and for tests. */
  yesterdayNet: number;
  yesterdayTrades: number;
}

function money(v: number | null, currency: string | null): string {
  if (v === null) return "—";
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return symbol ? `${sign}${symbol}${Math.abs(v).toFixed(2)}` : `${sign}${Math.abs(v).toFixed(2)} ${currency ?? ""}`.trim();
}

/** No +/− sign: for amounts that are a size, not a gain or loss. */
function plainMoney(v: number, currency: string | null): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  return symbol ? `${symbol}${Math.abs(v).toFixed(2)}` : `${Math.abs(v).toFixed(2)} ${currency ?? ""}`.trim();
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

function within(rows: BrokerTransaction[], fromMs: number, toMs: number): BrokerTransaction[] {
  return rows.filter((r) => {
    const t = parseUtc(r.dateUtc).getTime();
    return t >= fromMs && t < toMs;
  });
}

/**
 * @param rows every transaction of at least the last 30 days
 * @param now  when the report is being written
 */
export function buildDailyReport(
  rows: BrokerTransaction[],
  now: Date,
  context: { botRunning: boolean; dryRun: boolean; dailyTarget: number; modes?: string[] }
): DailyReport {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const DAY = 24 * 60 * 60 * 1000;

  const yesterday = summariseTransactions(within(rows, todayStart - DAY, todayStart));
  const week = summariseTransactions(within(rows, todayStart - 7 * DAY, todayStart));
  const month = summariseTransactions(within(rows, todayStart - 30 * DAY, todayStart));
  const currency = month.currency ?? week.currency ?? yesterday.currency;

  const dayLabel = utcDay(new Date(todayStart - DAY));
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  /**
   * How trades ended. The line that says whether the exit levels are doing
   * anything at all: on 24 Sep 2026 the average trade realised £0.21 on a £250
   * position — 0.084%, against a 1.5% stop and a 3% target — so neither level
   * was being reached and nobody could see that from the report.
   */
  const exitsLine = (s: ReturnType<typeof summariseTransactions>): string => {
    const { takeProfit, stopLoss, closedEarly } = s.exits;
    const parts = [`${takeProfit} take-profit`, `${stopLoss} stop-loss`, `${closedEarly} closed early`];
    return `  Exits:        ${parts.join(", ")}`;
  };

  const lines: string[] = [];
  lines.push(`Yesterday (${dayLabel})`);
  if (yesterday.closedTrades === 0) {
    lines.push("  No trades closed.");
  } else {
    lines.push(`  Result:       ${money(yesterday.netResult, currency)}`);
    lines.push(`  Trades:       ${yesterday.closedTrades} (${yesterday.wins} won, ${yesterday.losses} lost)`);
    if (context.dailyTarget > 0) {
      const short = context.dailyTarget - yesterday.netResult;
      lines.push(
        short <= 0
          ? `  Target:       ${plainMoney(context.dailyTarget, currency)} — met`
          : `  Target:       ${plainMoney(context.dailyTarget, currency)} — short by ${plainMoney(short, currency)}`
      );
    }
    lines.push(exitsLine(yesterday));
  }

  const block = (name: string, s: ReturnType<typeof summariseTransactions>) => {
    lines.push("");
    lines.push(name);
    if (s.closedTrades === 0) {
      lines.push("  No trades closed.");
      return;
    }
    lines.push(`  Result:       ${money(s.netResult, currency)}   (per trading day ${money(s.averagePerTradingDay, currency)})`);
    lines.push(`  Trades:       ${s.closedTrades}   win rate ${pct(s.winRate)}`);
    lines.push(`  Average win:  ${money(s.averageWin, currency)}      Average loss: ${money(s.averageLoss, currency)}`);
    lines.push(exitsLine(s));
    lines.push(`  Costs:        funding ${money(s.funding, currency)}, fees ${money(s.fees, currency)}`);
    if (s.byInstrument.length === 1) {
      // One instrument is neither best nor worst. Labelling it "Best" framed a
      // £2.17 LOSS as the good news in the report of 24 Sep 2026 — the only
      // instrument traded was also the only one losing money.
      const only = s.byInstrument[0]!;
      lines.push(`  Instrument:   ${only.instrumentName} ${money(only.net, currency)}`);
    } else if (s.byInstrument.length > 1) {
      const worst = s.byInstrument[0]!;
      const best = s.byInstrument[s.byInstrument.length - 1]!;
      // "Best" has to mean it made money. When everything lost, the top of the
      // list is the least bad, and saying so is the difference between a report
      // that reads as encouraging and one that reads as true.
      lines.push(`  ${best.net > 0 ? "Best:        " : "Least bad:   "} ${best.instrumentName} ${money(best.net, currency)}`);
      lines.push(`  Worst:        ${worst.instrumentName} ${money(worst.net, currency)}`);
    }
  };

  block("Last 7 days", week);
  block("Last 30 days", month);

  lines.push("");
  lines.push(`Bot: ${context.botRunning ? "running" : "STOPPED"}${context.dryRun ? ", dry run (no real orders)" : ""}`);
  // Which mode produced yesterday's numbers. Without this, a run of days is a
  // mixture of strategies and the results cannot be attributed to either.
  if (context.modes && context.modes.length > 0) {
    lines.push(
      context.modes.length === 1
        ? `Mode: ${context.modes[0]}`
        : `Modes yesterday: ${context.modes.join(" then ")} — results are a mixture`
    );
  }

  // The one judgement worth making, because the temptation is to read a good
  // week as proof. Below ~35% wins this loses money at any size; above it,
  // size scales it. That is only knowable with enough trades.
  if (month.closedTrades < MEANINGFUL_SAMPLE) {
    lines.push(
      `Sample: ${month.closedTrades} closed trades in 30 days. Around ${MEANINGFUL_SAMPLE} are needed before a win rate separates a working strategy from a lucky run.`
    );
  }
  lines.push("");
  lines.push("Full detail: https://www.tradebuzz.co.uk/performance");

  const headline =
    yesterday.closedTrades === 0
      ? "no trades closed"
      : `${money(yesterday.netResult, currency)} on ${yesterday.closedTrades} trade${yesterday.closedTrades === 1 ? "" : "s"}`;

  return {
    subject: `TradeBuzz daily: ${headline}`,
    text: lines.join("\n"),
    yesterdayNet: yesterday.netResult,
    yesterdayTrades: yesterday.closedTrades,
  };
}
