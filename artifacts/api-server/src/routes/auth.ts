import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_CLEAR_OPTIONS,
  createSession,
  deleteSession,
  hashPassword,
  verifyPassword,
} from "../lib/auth";
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
    res.status(201).json({ id: user.id, email: user.email });
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

    const { token } = await createSession(user.id);
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    res.json({ id: user.id, email: user.email });
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

router.get("/auth/me", requireAuth, (req, res): void => {
  res.set("Cache-Control", "no-store");
  res.json(req.user);
});

export default router;
