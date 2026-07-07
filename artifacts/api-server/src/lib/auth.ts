import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db, sessionsTable, usersTable, type User } from "@workspace/db";

export const SESSION_COOKIE = "tb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BCRYPT_ROUNDS = 12;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  signed: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_TTL_MS,
};

/**
 * For res.clearCookie(): must NOT include maxAge — Express's res.cookie()
 * recomputes `expires` from `maxAge` when both are present, which would
 * re-extend the cookie instead of clearing it.
 */
export const SESSION_COOKIE_CLEAR_OPTIONS = {
  httpOnly: SESSION_COOKIE_OPTIONS.httpOnly,
  signed: SESSION_COOKIE_OPTIONS.signed,
  sameSite: SESSION_COOKIE_OPTIONS.sameSite,
  secure: SESSION_COOKIE_OPTIONS.secure,
};

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessionsTable).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(token: string): Promise<User | null> {
  const [row] = await db
    .select({ user: usersTable, expiresAt: sessionsTable.expiresAt })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(eq(sessionsTable.id, token));

  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row.user;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.id, token));
}
