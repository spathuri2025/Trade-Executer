---
name: TradeBuzz architecture
description: How the TradeBuzz dashboard, Node api-server, and Python bot engine fit together and deploy.
---

# TradeBuzz architecture

Three pieces: a React dashboard (`/`), a Node Express api-server (`/api`), and a standalone Python FastAPI bot engine (`localhost:8001/engine`).

- **Request flow:** browser → dashboard → Node api-server (`/api`, session-cookie auth) → reverse-proxies to the Python bot, injecting `x-api-key` server-side. The browser never sees `ADMIN_API_KEY` and never talks to the bot directly.

**Why:** the bot's admin key must never reach the frontend; a session cookie at the Node layer is the trust boundary. The bot itself only authenticates via the admin key header.

- **The Python bot is NOT its own deployable artifact** (no raw-Python artifact type in this workspace). In production the api-server's `start-prod.sh` launches the bot as a supervised child process (restart loop) alongside Node. Bot listens on `PORT=8001 BASE_PATH=/engine`.

**Why:** only registered artifacts get services; the bot had to be bundled into the api-server's production run command to be deployed at all.

**How to apply:** if you add bot endpoints, expose them under `/engine/*` in FastAPI and they're automatically reachable via `/api/engine/*` — no proxy changes needed (the proxy forwards all subpaths). The dashboard accesses everything through `src/lib/engineApi.ts`.

- **Deploy on a Reserved VM, never Autoscale** — the bot runs a 24/7 APScheduler loop that must stay alive. `.replit` `deploymentTarget` is locked to `autoscale` and can't be changed programmatically; the user must pick Reserved VM in the Publish UI.

- **`/api/healthz` is Node-only liveness on purpose** — making it depend on the Python bot would fail deploys during bot restarts. Operator sees real bot state in the dashboard instead.

- **Production secrets are mandatory and hard-fail on boot:** `SESSION_SECRET` (>=16 chars, else session forgery is possible) and `ADMIN_API_KEY` (else unauthenticated upstream calls). Both checks are gated on `NODE_ENV === "production"`.
