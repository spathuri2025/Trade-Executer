/**
 * Market session arithmetic over Capital.com's `instrument.openingHours`.
 *
 * The shape, from Capital.com's own API examples:
 *
 *   "openingHours": {
 *     "mon": ["00:00 - 22:00", "23:05 - 00:00"],
 *     ...
 *     "sat": [], "sun": [],
 *     "zone": "UTC"
 *   }
 *
 * Each weekday lists its trading windows as "HH:MM - HH:MM". An end of "00:00"
 * means midnight at the END of that day. A continuous market is written as one
 * window running to 00:00 and the next day's window starting at 00:00, so
 * windows have to be merged across midnight before "when does this session end"
 * means anything.
 *
 * Deliberately conservative: anything it cannot read with certainty — a zone
 * other than UTC, a malformed window — yields null, and null means "do not act".
 * The caller closes positions on this answer, so an unreadable schedule must
 * never be mistaken for an imminent close.
 */

export type OpeningHours = Partial<Record<(typeof DAYS)[number], string[]>> & { zone?: string };

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_RE = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/;

/**
 * A pause shorter than this is not a session end. Index CFDs stop for about an
 * hour each night (e.g. 22:00-23:05) and resume; closing positions for that
 * would pay the spread twice a day for nothing. A stock's overnight close
 * (hours) and every weekend (days) comfortably exceed it.
 */
export const MIN_SESSION_GAP_MINUTES = 120;

interface Interval {
  start: number;
  end: number;
}

/** Midnight UTC at the start of the day containing `t`. */
function utcDayStart(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Every trading interval from three days before `now` to eight days after,
 * merged.
 *
 * Three days back, not one: a Monday session is preceded by the weekend, and
 * with a one-day lookback the Saturday and Sunday are empty, so Monday's open
 * had nothing before it and read as the edge of the window rather than as a
 * genuine open. Looking back to Friday gives it the preceding session it needs.
 */
function intervalsAround(hours: OpeningHours, now: number): Interval[] | null {
  const raw: Interval[] = [];
  const firstDay = utcDayStart(now) - 3 * DAY_MS;

  for (let i = 0; i < 12; i++) {
    const dayStart = firstDay + i * DAY_MS;
    const key = DAYS[new Date(dayStart).getUTCDay()];
    const windows = hours[key];
    if (windows === undefined) continue;
    if (!Array.isArray(windows)) return null;

    for (const w of windows) {
      const m = typeof w === "string" ? WINDOW_RE.exec(w) : null;
      if (!m) return null; // unreadable — refuse to guess
      const [sh, sm, eh, em] = m.slice(1).map(Number);
      if (sh > 23 || eh > 24 || sm > 59 || em > 59) return null;

      const start = dayStart + (sh * 60 + sm) * 60_000;
      let end = dayStart + (eh * 60 + em) * 60_000;
      // "00:00" as an end, or any end at/before the start, runs past midnight.
      if (end <= start) end += DAY_MS;
      raw.push({ start, end });
    }
  }

  raw.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    // Touching counts as continuous: "23:05 - 00:00" then "00:00 - 22:00" is
    // one session from 23:05 to 22:00 the next day, not two.
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ ...iv });
  }
  return merged;
}

/**
 * Minutes until the market's current session ends — counting only an end that
 * is followed by a break of at least MIN_SESSION_GAP_MINUTES.
 *
 * Returns null when there is nothing to act on or nothing trustworthy to act on:
 * no schedule, a zone other than UTC, an unreadable window, the market already
 * shut, or the next pause being too short to matter.
 */
export function minutesUntilSessionEnd(
  hours: OpeningHours | null | undefined,
  now: Date = new Date()
): number | null {
  if (!hours || typeof hours !== "object") return null;
  // The examples are all UTC. Converting another zone would need a timezone
  // database and DST rules, and a wrong conversion closes positions at the
  // wrong hour — so any other zone is declined outright.
  if (hours.zone !== undefined && (typeof hours.zone !== "string" || hours.zone.toUpperCase() !== "UTC")) return null;

  const t = now.getTime();
  const intervals = intervalsAround(hours, t);
  if (!intervals || intervals.length === 0) return null;

  const idx = intervals.findIndex((iv) => iv.start <= t && t < iv.end);
  if (idx === -1) return null; // closed right now: the unorderable gate handles that

  const current = intervals[idx];
  const next = intervals[idx + 1];
  // No next session inside the window means this one runs to the window's edge
  // — a 24/7 market. That edge is an artefact of how far we looked, not a close.
  if (!next) return null;
  const gapMinutes = (next.start - current.end) / 60_000;
  if (gapMinutes < MIN_SESSION_GAP_MINUTES) return null;

  return (current.end - t) / 60_000;
}

/**
 * Minutes since the market's current session began — counting only a start
 * preceded by a break of at least MIN_SESSION_GAP_MINUTES.
 *
 * The mirror of minutesUntilSessionEnd, and it exists for a measured reason. At
 * the US open on 24 Sep 2026 the strategy produced five signals in six minutes
 * and the AI guard refused all five, every time on the same grounds: the two
 * moving averages were almost touching (SPCX 148.49 against 148.42, 0.047%
 * apart) and the price had already left them behind. A 21-period average of
 * 5-minute bars is 105 minutes of history, so at the opening bell every one of
 * those bars is from yesterday. The averages walk yesterday's path while the
 * price gaps, and the crossover fires in the direction the price has just
 * abandoned.
 *
 * Returns null on the same terms as its mirror: no schedule, a non-UTC zone, an
 * unreadable window, a market currently shut, a 24/7 market, or a preceding
 * pause too short to be a real open. Null means "nothing to act on".
 */
export function minutesSinceSessionStart(
  hours: OpeningHours | null | undefined,
  now: Date = new Date()
): number | null {
  if (!hours || typeof hours !== "object") return null;
  if (hours.zone !== undefined && (typeof hours.zone !== "string" || hours.zone.toUpperCase() !== "UTC")) return null;

  const t = now.getTime();
  const intervals = intervalsAround(hours, t);
  if (!intervals || intervals.length === 0) return null;

  const idx = intervals.findIndex((iv) => iv.start <= t && t < iv.end);
  if (idx === -1) return null;

  const current = intervals[idx];
  const prev = intervals[idx - 1];
  // Nothing before it inside the window we looked at: either a 24/7 market or
  // an edge created by how far back we looked, neither of which is an open.
  if (!prev) return null;
  const gapMinutes = (current.start - prev.end) / 60_000;
  if (gapMinutes < MIN_SESSION_GAP_MINUTES) return null;

  return (t - current.start) / 60_000;
}

/** The session end as a clock time, for messages the user reads: "20:00 UTC". */
export function formatSessionEnd(minutesAway: number, now: Date = new Date()): string {
  const end = new Date(now.getTime() + minutesAway * 60_000);
  return `${String(end.getUTCHours()).padStart(2, "0")}:${String(end.getUTCMinutes()).padStart(2, "0")} UTC`;
}
