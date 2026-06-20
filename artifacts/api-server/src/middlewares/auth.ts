import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../lib/session";

export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  const token = cookies?.[SESSION_COOKIE_NAME];
  if (verifySessionToken(token)) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
}
