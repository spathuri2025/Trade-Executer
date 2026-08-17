import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_CLEAR_OPTIONS,
  createSession,
  deleteSession,
  deleteOtherSessionsForUser,
  deleteAllSessionsForUser,
  hashPassword,
  verifyPassword,
} from "../lib/auth";
import { sendEmail } from "../lib/email";
import { hashResetToken, issueResetToken, isResetTokenUsable } from "../lib/passwordReset";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function parseCredentials(body: unknown): { email: string; password: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const email = typeof b["email"] === "string" ? b["email"].trim().toLowerCase() : "";
  const password = typeof b["password"] === "string" ? b["password"] : "";
  if (!email || !password) return null;
  return { email, password };
}

router.post("/auth/signup", authRateLimit, async (req, res): Promise<void> => {
  const parsed = parseCredentials(req.body);
  if (!parsed || !EMAIL_RE.test(parsed.email)) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  if (parsed.password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.email));
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  try {
    const passwordHash = await hashPassword(parsed.password);
    const [user] = await db
      .insert(usersTable)
      .values({ email: parsed.email, passwordHash })
      .returning();
    if (!user) throw new Error("Failed to create user");

    const { token } = await createSession(user.id);
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    req.log.error({ err }, "Signup failed");
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.post("/auth/login", authRateLimit, async (req, res): Promise<void> => {
  const parsed = parseCredentials(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.email));
    const valid = user ? await verifyPassword(parsed.password, user.passwordHash) : false;
    if (!user || !valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Checked here (not just in requireAuth) so a suspended customer finds out
    // immediately at login instead of getting a session cookie that then 403s.
    if (user.suspendedAt) {
      res.status(403).json({ error: "Your account has been suspended. Contact support." });
      return;
    }

    const { token } = await createSession(user.id);
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    res.json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    req.log.error({ err }, "Login failed");
    res.status(500).json({ error: "Failed to log in" });
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    await deleteSession(token);
  }
  res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_CLEAR_OPTIONS);
  res.sendStatus(204);
});

/**
 * Change your own password, proving you know the current one.
 *
 * Rate-limited like login: without it this endpoint is an oracle for
 * brute-forcing the current password of an already-hijacked session.
 */
router.post("/auth/change-password", requireAuth, authRateLimit, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const currentPassword = typeof body["currentPassword"] === "string" ? body["currentPassword"] : "";
  const newPassword = typeof body["newPassword"] === "string" ? body["newPassword"] : "";

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are both required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ error: "Your new password must be different from the current one" });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      res.status(400).json({ error: "Your current password is incorrect" });
      return;
    }

    await db
      .update(usersTable)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(usersTable.id, user.id));

    // Sign out everywhere else, so a session someone else obtained under the
    // old password stops working. The caller's own session is kept so they
    // aren't logged out of the page they just used.
    const token = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
    if (token) await deleteOtherSessionsForUser(user.id, token);

    req.log.info({ userId: user.id }, "Password changed");
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Password change failed");
    res.status(500).json({ error: "Failed to change password" });
  }
});

/**
 * Start a password reset.
 *
 * ALWAYS responds 204, whether or not the address has an account. Responding
 * differently would turn this into an account-enumeration oracle, letting
 * anyone check which emails are registered. The same reason it doesn't report
 * email-delivery failures to the caller.
 */
router.post("/auth/forgot-password", authRateLimit, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";

  if (!email || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

    if (user) {
      const { token, tokenHash, expiresAt } = issueResetToken();
      await db.insert(passwordResetTokensTable).values({ userId: user.id, tokenHash, expiresAt });

      // APP_BASE_URL keeps the link pointing at the real site; falling back to
      // the request's own origin keeps this working in local development.
      const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const link = `${base}/reset-password?token=${token}`;

      await sendEmail({
        to: user.email,
        subject: "Reset your TradeBuzz password",
        text: [
          "Someone asked to reset the password for your TradeBuzz account.",
          "",
          "Use this link within the next hour to choose a new one:",
          link,
          "",
          "If that wasn't you, you can ignore this email — your password stays unchanged.",
        ].join("\n"),
      });
    } else {
      // Logged so a genuine "I never got the email" support question can be
      // answered, without telling the requester anything.
      req.log.info({ email }, "Password reset requested for an address with no account");
    }

    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Password reset request failed");
    // Still 204 — an error here must not reveal whether the account exists.
    res.sendStatus(204);
  }
});

/** Redeem a reset token and set a new password. */
router.post("/auth/reset-password", authRateLimit, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const token = typeof body["token"] === "string" ? body["token"] : "";
  const newPassword = typeof body["newPassword"] === "string" ? body["newPassword"] : "";

  if (!token || !newPassword) {
    res.status(400).json({ error: "Token and new password are both required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.tokenHash, hashResetToken(token)));

    // One message for every failure mode (unknown / expired / already used) —
    // the distinctions are only useful to someone probing tokens.
    if (!row || !isResetTokenUsable(row)) {
      res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
      return;
    }

    await db
      .update(usersTable)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(usersTable.id, row.userId));

    await db
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokensTable.id, row.id));

    // A reset implies the old password may be compromised, so drop every
    // existing session — including any an attacker is holding.
    await deleteAllSessionsForUser(row.userId);

    req.log.info({ userId: row.userId }, "Password reset completed");
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Password reset failed");
    res.status(500).json({ error: "Failed to reset password" });
  }
});

router.get("/auth/me", requireAuth, (req, res): void => {
  res.set("Cache-Control", "no-store");
  res.json(req.user);
});

export default router;
