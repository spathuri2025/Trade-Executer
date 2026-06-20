# TradeBuzz

An automated crypto/forex trading bot with a dark trading-terminal control-panel dashboard. The bot runs a strategy on a schedule inside the Node API server; the dashboard lets a single operator log in to monitor live trades, signals, the market scanner, instruments, and account/positions, and configure/start/stop the bot from anywhere.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the Node API server (port 8080; serves `/api`, runs the bot loop)
- `pnpm --filter @workspace/tradebuzz-dashboard run dev` — run the dashboard (served at `/`)
- `pnpm --filter @workspace/db run push` — push the Drizzle schema to the database
- `pnpm --filter @workspace/api-spec run codegen` — regenerate the API client/zod from the OpenAPI spec
- `pnpm --filter @workspace/<slug> run typecheck` — typecheck a package
- `pnpm run typecheck` — full typecheck across all packages
- Required env (production secrets): `SESSION_SECRET` (>=16 chars), `ADMIN_API_KEY`, `DATABASE_URL`, `CAPITAL_COM_API_KEY`, `CAPITAL_COM_PASSWORD`, `CAPITAL_COM_EMAIL`. Optional: `DASHBOARD_PASSWORD` (the dashboard login password; falls back to `ADMIN_API_KEY`).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Dashboard: React + Vite, shadcn/ui, wouter, TanStack Query, recharts, framer-motion, sonner
- API server: Express 5 — session auth + the trading bot engine (in-process scheduler), plus the Capital.com broker client
- DB: PostgreSQL (Drizzle ORM)

## Where things live

- `artifacts/tradebuzz-dashboard/` — the operator dashboard (login gate + dashboard/trades/signals/scanner/instruments/settings). Data access goes through the generated React Query hooks in `@workspace/api-client-react` (do not bypass them). `src/pages/login.tsx` is the login screen; `src/App.tsx` gates the app on `/api/auth/me`.
- `artifacts/api-server/` — Express server. Auth: `src/lib/session.ts` (HMAC-signed `tb_dash` cookie), `src/middlewares/auth.ts` (`requireSession`), `src/routes/auth.ts` (login/logout/me). The bot + broker: `src/lib/botEngine.ts` (setInterval loop, MA strategy, risk, `dryRun` default true), `src/lib/capitalcom.ts`, `src/lib/scannerEngine.ts`, `src/lib/newsService.ts`. Routes under `src/routes/` (bot, trades, signals, scanner, instruments, positions, news, health).
- `lib/` — shared workspace libs: `db` (Drizzle schema: instruments/trades/signals/scanner_results), `api-spec` (OpenAPI + orval codegen), `api-zod`, `api-client-react` (generated hooks).

## Architecture decisions

- **Single app, single process for the bot.** The browser talks only to the Node api-server over a session cookie. There is no separate Python service — the trading loop runs in-process in the api-server via `setInterval` (see `botEngine.ts`). The browser never sees `ADMIN_API_KEY` or the Capital.com credentials; the server calls Capital.com directly server-side.
- **Auth gate.** `/api/healthz` and `/api/auth/*` are public; every other `/api/*` route is behind `requireSession`. The dashboard shows the login screen until `/api/auth/me` reports authenticated.
- **Capital.com secret names.** The broker client reads `CAPITAL_COM_API_KEY` / `CAPITAL_COM_PASSWORD` / `CAPITAL_COM_EMAIL` (the email is the Capital.com login identifier). Legacy `CAPITALCOM_*` names are still accepted as a fallback.
- **PAPER/dry-run by default.** The bot trades in dry-run mode until explicitly enabled, so no real money is at risk while testing.
- `/api/healthz` is a fast Node-only liveness probe so deploys don't fail during startup.

## Deployment

- Publish with a **Reserved VM** (NOT Autoscale) — the bot runs a 24/7 in-process scheduler that must stay alive continuously. Autoscale would suspend it.
- Production: build = `pnpm --filter @workspace/api-server run build`; run = `node --enable-source-maps artifacts/api-server/dist/index.mjs`. Health check = `/api/healthz`.
- Eventual custom domain: tradebuzz.co.uk.

## User preferences

- User is non-technical — explain in plain English, avoid jargon.
- Wants the bot always-on 24/7; eventual custom domain tradebuzz.co.uk.

## Gotchas

- `SESSION_SECRET` and `ADMIN_API_KEY` are mandatory in production — the api-server hard-fails on boot without them (prevents session forgery / unauthenticated access).
- The Capital.com broker API is blocked in the Replit dev environment; it works once deployed. The bot runs in PAPER/dry-run mode meanwhile.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
