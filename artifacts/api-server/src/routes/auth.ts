import { Router, type IRouter } from "express";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  dashboardPassword,
  verifySessionToken,
} from "../lib/session";

const router: IRouter = Router();

const isProduction = process.env["NODE_ENV"] === "production";

router.post("/auth/login", (req, res) => {
  const password = (req.body as { password?: unknown } | undefined)?.password;
  const expected = dashboardPassword();
  if (
    typeof password !== "string" ||
    expected === "" ||
    password !== expected
  ) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  res.cookie(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
    path: "/",
  });
  res.json({ ok: true });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

router.get("/auth/me", (req, res) => {
  const cookies = (req as typeof req & { cookies?: Record<string, string> })
    .cookies;
  res.json({ authenticated: verifySessionToken(cookies?.[SESSION_COOKIE_NAME]) });
});

export default router;
