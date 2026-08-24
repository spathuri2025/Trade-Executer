/**
 * Writes the admin audit trail. One entry point, so every admin action that
 * matters is recorded the same way and "what can an admin do without leaving
 * a trace" is answerable by reading this file's call sites.
 *
 * Never throws. An audit write failing must not fail the action itself — a
 * suspended account that didn't get logged is far better than an admin unable
 * to suspend. Failures are logged loudly instead.
 */
import { desc, eq } from "drizzle-orm";
import { db, auditLogTable, usersTable, type AuditLogRow } from "@workspace/db";
import { logger } from "./logger";

export type AuditAction = AuditLogRow["action"];

export interface AuditEntry {
  action: AuditAction;
  /** Who the action was done TO, where applicable (announcements have no target). */
  targetUserId?: number;
  targetEmail?: string;
  /** Human-readable summary, e.g. "plan: free → pro, status: active". */
  detail?: string;
}

export async function recordAudit(
  actor: { id: number; email: string },
  entry: AuditEntry,
): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: entry.action,
      targetUserId: entry.targetUserId ?? null,
      targetEmail: entry.targetEmail ?? null,
      detail: entry.detail ?? null,
    });
  } catch (err) {
    logger.error({ err, actor: actor.email, action: entry.action }, "AUDIT WRITE FAILED");
  }
}

/** Most recent entries for the Admin Centre. Append-only, so newest first. */
export async function listAudit(limit = 100): Promise<
  Array<{
    id: number;
    actorEmail: string;
    action: AuditAction;
    targetEmail: string | null;
    detail: string | null;
    createdAt: string;
  }>
> {
  const rows = await db
    .select()
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    actorEmail: r.actorEmail,
    action: r.action,
    targetEmail: r.targetEmail,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Look up a user's email for the audit record BEFORE the action destroys it.
 * Deleting a customer removes the row, so the email has to be captured first
 * or the log ends up saying "someone deleted user 2" — which is exactly the
 * uninformative answer this table exists to prevent.
 */
export async function lookupEmail(userId: number): Promise<string | null> {
  try {
    const [row] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
    return row?.email ?? null;
  } catch {
    return null;
  }
}
