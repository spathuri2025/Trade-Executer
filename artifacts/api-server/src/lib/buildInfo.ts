/**
 * Which build this process is running.
 *
 * On 24 Sep 2026 three separate diagnoses had to infer the live version from
 * the spacing of trading-cycle timestamps — the only observable that changed
 * when a deploy landed. That is a guess, and it is ambiguous the moment a user
 * stops and starts the bot themselves, which re-arms the same timers.
 *
 * Render sets RENDER_GIT_COMMIT on every deploy. Reading it costs nothing and
 * turns "I think the fix is live" into a fact.
 */

/** Captured once: the process start time, so a restart is visible as a change. */
const STARTED_AT = new Date();

export interface BuildInfo {
  /** Short commit sha, or "unknown" when not running under a deploy (local dev). */
  commit: string;
  startedAt: string;
}

export function buildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  // Render's own variable first; the others are for running the same image
  // elsewhere without a code change.
  const sha = env["RENDER_GIT_COMMIT"] ?? env["GIT_COMMIT"] ?? env["SOURCE_VERSION"] ?? "";
  return {
    // Short form only. The full sha adds nothing a human reads, and this
    // endpoint is public — a commit id is not a secret, but there is no reason
    // to publish more of it than is useful.
    commit: sha ? sha.slice(0, 7) : "unknown",
    startedAt: STARTED_AT.toISOString(),
  };
}
