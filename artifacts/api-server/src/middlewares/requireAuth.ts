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

  req.user = { id: user.id, email: user.email };
  next();
}
