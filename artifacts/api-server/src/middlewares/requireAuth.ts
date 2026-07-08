import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, getSessionUser } from "../lib/auth";

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const user = await getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // A suspended account is blocked on every request, not just at login — an
  // admin suspending someone mid-session must take effect immediately.
  if (user.suspendedAt) {
    res.status(403).json({ error: "Your account has been suspended. Contact support." });
    return;
  }

  req.user = { id: user.id, email: user.email, role: user.role };
  next();
}
