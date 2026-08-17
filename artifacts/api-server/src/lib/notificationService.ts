/**
 * The one place notifications enter the system. Every event a user hears about
 * — a support reply, an announcement, their circuit breaker tripping, an
 * upgrade request being handled — goes through notifyUser, so "what can reach
 * a user, and does it email them" is auditable in this single file.
 *
 * Nothing here ever throws. Callers include the circuit-breaker path inside a
 * live trading cycle; a notification (or Resend) failure must never break the
 * thing it is notifying about. Failures are logged and swallowed, matching
 * sendEmail's own contract.
 */
import { isNull, and, eq } from "drizzle-orm";
import { db, notificationsTable, announcementsTable, usersTable } from "@workspace/db";
import { sendEmail } from "./email";
import { logger } from "./logger";

export type NotificationType = "support_reply" | "announcement" | "circuit_breaker" | "upgrade_handled";

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  /** In-app path the notification points at, e.g. "/inbox". */
  link?: string;
}

/**
 * Whether each type also goes out by email. All four do today, but keeping it
 * explicit means adding a noisy in-app-only type later is a one-line change
 * rather than a redesign.
 */
const EMAILED_TYPES: Record<NotificationType, boolean> = {
  support_reply: true,
  announcement: true,
  circuit_breaker: true,
  upgrade_handled: true,
};

function emailFooter(link?: string): string {
  const base = process.env.APP_BASE_URL || "https://www.tradebuzz.co.uk";
  return `\n\n—\nOpen TradeBuzz: ${base}${link ?? "/inbox"}\nYou're receiving this because of activity on your TradeBuzz account.`;
}

/** Insert an in-app notification and (best-effort) email the user. Never throws. */
export async function notifyUser(userId: number, input: NotifyInput): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? "/inbox",
    });
  } catch (err) {
    logger.error({ err, userId, type: input.type }, "Failed to insert notification");
    // In-app insert failed — still try the email below; each channel is
    // independent so one failing shouldn't silence the other.
  }

  if (!EMAILED_TYPES[input.type]) return;

  try {
    const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return;
    // sendEmail never throws and logs its own failures.
    await sendEmail({
      to: user.email,
      subject: `TradeBuzz — ${input.title}`,
      text: `${input.body}${emailFooter(input.link)}`,
    });
  } catch (err) {
    logger.error({ err, userId, type: input.type }, "Failed to email notification");
  }
}

/**
 * Create an announcement and deliver it to every active (non-suspended) user.
 * Returns how many users it reached, for the admin UI's confirmation toast.
 */
export async function broadcastAnnouncement(
  title: string,
  body: string,
  createdBy: number,
): Promise<{ announcementId: number; recipients: number }> {
  const [announcement] = await db
    .insert(announcementsTable)
    .values({ title, body, createdBy })
    .returning();
  if (!announcement) throw new Error("Failed to create announcement");

  // Suspended accounts are excluded: they can't log in to read it, and
  // emailing someone you've suspended is at best confusing.
  const recipients = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(isNull(usersTable.suspendedAt)));

  for (const user of recipients) {
    // Sequential on purpose — Resend rate-limits, and notifyUser swallows its
    // own failures so one bad address never stops the rest of the fan-out.
    await notifyUser(user.id, { type: "announcement", title, body, link: "/inbox" });
  }

  logger.info({ announcementId: announcement.id, recipients: recipients.length }, "Announcement broadcast");
  return { announcementId: announcement.id, recipients: recipients.length };
}
