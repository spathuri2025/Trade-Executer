# TradeBuzz

An automated crypto/forex trading bot ("TradeBuzz Bot Engine") with a dark trading-terminal control-panel dashboard. The bot runs strategies on a schedule; the dashboard lets a single operator monitor live trades, signals, P&L, and risk, and pull the levers (start / stop / pause / emergency-stop) from anywhere.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the Node API server (port 8080; serves `/api`)
- `cd artifacts/tradebuzz-bot-engine && python run.py` — run the Python bot engine (port 8001; serves `/engine`)
- `pnpm --filter @workspace/tradebuzz-dashboard run dev` — run the dashboard (served at `/`)
- `pnpm --filter @workspace/<slug> run typecheck` — typecheck a package
- `pnpm run typecheck` — full typecheck across all packages
- Required env (production secrets): `SESSION_SECRET` (>=16 chars), `ADMIN_API_KEY`, `DATABASE_URL`, `CAPITAL_COM_*`. Optional: `DASHBOARD_PASSWORD` (falls back to `ADMIN_API_KEY`).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9, Python 3.11
- Dashboard: React + Vite, shadcn/ui, wouter, TanStack Query, recharts, framer-motion, sonner
- API server: Express 5 (auth + reverse proxy to the bot)
- Bot engine: FastAPI + SQLAlchemy + APScheduler (standalone Python, not a deployable artifact on its own)
- DB: PostgreSQL

## Where things live

- `artifacts/tradebuzz-dashboard/` — the operator dashboard (login + dashboard/trades/signals/strategies/risk/logs). API layer: `src/lib/engineApi.ts` (hand-written fetch client + React Query hooks; the single source of truth for dashboard data access — do not bypass it).
- `artifacts/api-server/` — Node auth + proxy. `src/lib/session.ts` (HMAC signed `tb_dash` cookie), `src/middlewares/auth.ts`, `src/routes/auth.ts` (login/logout/me), `src/routes/engine.ts` (session-gated reverse proxy `/api/engine/*` → bot, injects `x-api-key`). `start-prod.sh` launches the Python bot + Node together in production.
- `artifacts/tradebuzz-bot-engine/` — the FastAPI bot. Serves under `BASE_PATH=/engine`; `run.py` is the entrypoint.

## Architecture decisions

- The browser never talks to the Python bot directly and never sees `ADMIN_API_KEY`. Flow: dashboard (`/`) → Node api-server (`/api`, session-cookie auth) → reverse-proxies to the Python bot (`localhost:8001/engine/*`) injecting the admin key server-side.
- The Python bot is NOT its own deployable artifact (no artifact type for raw Python here). In production, the api-server's `start-prod.sh` starts the bot as a supervised child process (auto-restarts if it exits) alongside Node.
- `/api/healthz` is an intentionally fast Node-only liveness probe so deploys don't fail while the bot is (re)starting. The operator sees real-time bot availability in the dashboard instead.
- Dashboard runs in PAPER mode until `LIVE_TRADING_ENABLED=true` and `BOT_MODE=LIVE`; mode is surfaced prominently in the UI so the operator always knows whether real money is at risk.

## Deployment

- Publish with a **Reserved VM** (NOT Autoscale) — the bot runs a 24/7 background scheduler that must stay alive continuously. Autoscale would suspend it.
- Production build installs the bot's Python deps then builds Node; production run is `start-prod.sh`.

## User preferences

- User is non-technical — explain in plain English, avoid jargon.
- Wants the bot always-on 24/7; eventual custom domain tradebuzz.co.uk.

## Gotchas

- `SESSION_SECRET` and `ADMIN_API_KEY` are mandatory in production — the api-server hard-fails on boot without them (prevents session forgery / unauthenticated upstream calls).
- The Capital.com broker API is blocked in the Replit dev environment; it works once deployed. The bot runs in PAPER mode meanwhile.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
