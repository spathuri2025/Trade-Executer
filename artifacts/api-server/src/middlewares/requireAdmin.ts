import type { Request, Response, NextFunction } from "express";

/** Must run after requireAuth — relies on req.user already being set. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
