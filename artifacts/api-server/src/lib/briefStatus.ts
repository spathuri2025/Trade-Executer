/**
 * Whether a stored daily brief is actually today's.
 *
 * On 5 Oct 2026 the briefing read "your full £4,963 available" when the account
 * held £4,521. The figure was not wrong when it was written — it was written on
 * 28 September. The route returned the newest brief on file whenever today's
 * did not exist yet, undated and indistinguishable from a current one, while
 * regenerating in the background.
 *
 * A week-old balance presented as this morning's is worse than no briefing at
 * all, so the server now states plainly which it is handing over.
 */
export interface BriefStatus {
  /** True when the brief on hand was written for an earlier day. */
  stale: boolean;
  /** True when a fresh one is being written right now. */
  generating: boolean;
}

export function briefStatus(
  briefDate: string | null | undefined,
  today: string,
  generating: boolean
): BriefStatus {
  // No brief at all is not stale — there is nothing to mislead anyone with.
  if (!briefDate) return { stale: false, generating };
  return { stale: briefDate !== today, generating };
}
