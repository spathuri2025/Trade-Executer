/**
 * The limits that bound how much an account can lose, kept as pure functions so
 * every one of them can be tested without a broker, a database or a clock.
 *
 * Three of these exist because of specific failures:
 *
 * - The daily-loss and intraday-drawdown baselines lived only in memory, so a
 *   deploy mid-session silently re-measured the day from the restart. An
 *   account already £80 down started again from zero and could lose the limit
 *   twice in one day. The marks are now persisted, and this module owns the
 *   rolling of them.
 * - Only a DAY was ever bounded. Five days each losing 1.9% pass every limit in
 *   the product and still cost 9% of the account, so a week is bounded too.
 * - Nothing was absolute. A percentage limit re-bases every day: an account can
 *   fall forever in compliant steps. The equity floor is the one limit that
 *   does not move.
 *
 * All percentages are measured against the baseline for the period, not against
 * a peak, except the intraday drawdown, which is deliberately peak-relative
 * (see the engine's own note on why).
 */

/** Persisted equity baselines. Nulls mean "not observed yet", never zero. */
export interface EquityMarks {
  dayKey: string | null;
  dayStartEquity: number | null;
  /** Highest equity seen today — the reference for the intraday drawdown halt. */
  dayPeakEquity: number | null;
  weekKey: string | null;
  weekStartEquity: number | null;
  /** The UTC day on which the daily profit target was reached, if it was. */
  profitLockedDayKey: string | null;
}

export interface HardLimitConfig {
  /** Absolute equity below which the bot must not trade. 0 = off. */
  equityFloor: number;
  /** Halt when equity falls this far below the week's opening equity. 0 = off. */
  maxWeeklyLossPercent: number;
}

export interface LimitBreach {
  /** Stable identifier for logs and tests; the reason is for the user. */
  code: "equity_floor" | "weekly_loss";
  reason: string;
}

export function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * ISO-8601 week key, e.g. "2026-W39". Weeks start Monday, which is what a
 * trading week means — a Sunday-start week would cut the Asian Monday open away
 * from the rest of its own week.
 */
export function utcWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Shift to the Thursday of this week: the ISO year is the year that Thursday
  // falls in, which is what makes the turn of the year come out right.
  const day = t.getUTCDay() || 7; // Sunday is 7, not 0
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Rolls the baselines for a new observation of equity. Returns fresh marks —
 * the caller decides whether to persist them, so a failed write can never leave
 * memory and the database disagreeing about which day is being measured.
 *
 * A new day inside the same week keeps the week's baseline: that is the whole
 * point of having one.
 */
export function rollMarks(marks: EquityMarks, equity: number, now: Date): EquityMarks {
  const dayKey = utcDayKey(now);
  const weekKey = utcWeekKey(now);
  const next: EquityMarks = { ...marks };

  if (next.dayKey !== dayKey || next.dayStartEquity === null) {
    next.dayKey = dayKey;
    next.dayStartEquity = equity;
    next.dayPeakEquity = equity;
  } else if (next.dayPeakEquity === null || equity > next.dayPeakEquity) {
    next.dayPeakEquity = equity;
  }

  if (next.weekKey !== weekKey || next.weekStartEquity === null) {
    next.weekKey = weekKey;
    next.weekStartEquity = equity;
  }

  return next;
}

/**
 * The two limits that are not day-scoped, in order of severity. Checked before
 * the daily limits: an account under its floor must stop whatever today's
 * numbers look like.
 */
export function hardLimitBreach(marks: EquityMarks, equity: number, cfg: HardLimitConfig): LimitBreach | null {
  if (cfg.equityFloor > 0 && equity <= cfg.equityFloor) {
    return {
      code: "equity_floor",
      reason:
        `Account equity is ${equity.toFixed(2)}, at or below your floor of ${cfg.equityFloor.toFixed(2)}. ` +
        `Trading is halted. Nothing will reopen it automatically — lower the floor or add funds, then resume.`,
    };
  }

  if (cfg.maxWeeklyLossPercent > 0 && marks.weekStartEquity !== null && marks.weekStartEquity > 0) {
    const lossPct = ((marks.weekStartEquity - equity) / marks.weekStartEquity) * 100;
    if (lossPct >= cfg.maxWeeklyLossPercent) {
      return {
        code: "weekly_loss",
        reason:
          `This week's loss of ${lossPct.toFixed(2)}% reached your ${cfg.maxWeeklyLossPercent}% weekly limit. ` +
          `Trading is halted until you resume it; the limit measures again from Monday.`,
      };
    }
  }

  return null;
}

/**
 * The run of losing trades at the end of the list — how many, and what they
 * cost. Trades must be oldest-first.
 *
 * The cost matters as much as the count. On 24 Sep 2026 the breaker halted
 * trading for the rest of the day after six consecutive losses averaging £0.23:
 * a total of about £1.38. Counting events treats six pennies and six percent
 * alike, and only one of those is evidence that conditions have changed.
 *
 * A trade closed at exactly zero is neither a win nor a loss and ends the
 * streak — it is not evidence of anything, and counting it as a loss would halt
 * on a flat scratch.
 */
export function trailingLossStreak(trades: Array<{ result: number }>): { count: number; loss: number } {
  let count = 0;
  let loss = 0;
  for (let i = trades.length - 1; i >= 0; i -= 1) {
    const result = trades[i]?.result ?? 0;
    if (result < 0) {
      count += 1;
      loss += -result; // positive magnitude, so the caller compares like with like
    } else break;
  }
  return { count, loss };
}

/**
 * Whether a new position in this instrument is still inside its cooldown.
 *
 * Two reasons, and the second is the one that matters: a second entry can be
 * placed before the broker's position list shows the first. On 24 Sep 2026 a
 * mode switch fired an extra cycle 10 seconds after a normal one and bought
 * GOLD and US500 a second time — the open-position check could not see the
 * first fill yet. Our own order log can, so the cooldown reads from that and is
 * immune to the lag.
 */
export function withinCooldown(lastOrderAt: Date | null, now: Date, cooldownMinutes: number): boolean {
  if (cooldownMinutes <= 0 || lastOrderAt === null) return false;
  return now.getTime() - lastOrderAt.getTime() < cooldownMinutes * 60_000;
}
