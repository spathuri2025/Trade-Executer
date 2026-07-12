# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**TradeBuzz** — an algorithmic trading bot dashboard (ClinAITech Limited, UK). Brokers: Trading 212 + Capital.com.
MA-crossover strategy with a market scanner, plus an "AI Market Intelligence" layer built on Claude/GPT. Dark
"Obsidian Noir" theme. Built as a Replit pnpm workspace (Node 24, TypeScript 5.9).

**Session auth is required app-wide** (login/signup at `/login`/`/signup`; every API route except `/healthz` and
`/auth/*` requires a logged-in session — see `.agents/memory/session-auth.md`). **Multi-tenant**: each user
connects their own broker (Capital.com or Trading 212) and gets a fully isolated bot — `instruments`/`trades`/
`signals`/`scannerResults`/`bot_config`/`broker_credentials`/`conversations` are all scoped by `userId`, and
`botEngine.ts`/`scannerEngine.ts` are per-user (`Map<userId, State>`), not global singletons. See
`.agents/memory/multi-tenant-broker.md`. Exception: market-wide AI content (market news/brain/daily briefs)
intentionally stays global/shared — see `.agents/memory/session-auth.md` for exactly which. Live price
*streaming* (WebSocket push) is per-user too — see `.agents/memory/capital-streaming.md`. An **Admin
Centre** (`/admin`, role-gated) lets an operator manage customers — see `.agents/memory/admin-centre.md`.

## Commands

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000; builds then starts)
- `pnpm --filter @workspace/trading-bot run dev` — run the frontend (Vite dev server)
- `pnpm run typecheck` — full typecheck across all packages (libs via `tsc --build`, then artifacts/scripts)
- `pnpm run build` — typecheck + build all packages (needs workflow-provided `PORT`/`BASE_PATH` — prefer `typecheck` for verification)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks (`@workspace/api-client-react`) and Zod schemas from `lib/api-spec/openapi.yaml`; re-run after any OpenAPI spec edit
- `pnpm --filter @workspace/db run push` — push Drizzle schema changes to Postgres (dev only; requires `DATABASE_URL`)
- `pnpm --filter @workspace/api-server test` — run backend tests once (vitest); `test:watch` for watch mode
  - Single test file: `pnpm --filter @workspace/api-server exec vitest run src/lib/botEngine.test.ts`
- Required env: `DATABASE_URL` (Postgres connection string), `SESSION_SECRET` (signs session cookies), `CREDENTIALS_ENCRYPTION_KEY` (32-byte hex, encrypts broker credentials at rest) — the server refuses to boot without any of these
- Package manager is enforced: the root `preinstall` script errors if you use anything but `pnpm`

## Architecture

### Workspace layout
- `artifacts/api-server` — Express 5 backend (esbuild → CJS bundle, entry `src/index.ts` → `src/app.ts`). Routes in `src/routes/*`, business logic in `src/lib/*`.
- `artifacts/trading-bot` — the actual product frontend (Vite + React 19 + wouter + TanStack Query). Pages in `src/pages/*`, feature components in `src/components/*`.
- `artifacts/mockup-sandbox` — standalone Vite sandbox for UI mockups, not part of the shipped product.
- `lib/db` — Drizzle ORM schema (`src/schema/*`) + Postgres client, consumed by api-server.
- `lib/api-spec` — `openapi.yaml` is the **source of truth** for the API contract; Orval generates the client from it.
- `lib/api-client-react` / `lib/api-zod` — generated output (React Query hooks / Zod schemas) — don't hand-edit, re-run codegen instead.
- `lib/integrations-anthropic-ai`, `lib/integrations-openai-ai-server`, `lib/integrations-openai-ai-react` — thin wrappers around Replit's managed Claude/OpenAI proxies (no API keys needed/stored in this repo).
- `scripts` — misc workspace scripts (`post-merge.sh` runs `pnpm install --frozen-lockfile` + `pnpm --filter db push` after merges).
- `.agents/memory/*.md` — accumulated non-obvious gotchas from prior agent sessions on this repo (indexed in `.agents/memory/MEMORY.md`). **Read these before touching the areas they cover** — each captures a bug that already happened once.

### Contract-first API
Define the endpoint in `lib/api-spec/openapi.yaml` first, then run codegen, then implement the route. Conventions:
- Nullable fields use `type: ["string","null"]`, not `nullable: true`.
- Route handlers validate inputs **manually** (mirror `routes/news.ts`) instead of importing generated Zod — this decouples handlers from Orval's generated names, which shift with `operationId`. Only `signals.ts` imports a generated type (`ListSignalsQueryParams`).
- A path param + query params on the *same* operation makes Orval emit two colliding `<OpId>Params` exports — prefer an all-query-param design (e.g. `/candles?epic=`) when both are needed.
- SSE endpoints (assistant chat, signal analyst chat, live price stream) are **not** in the OpenAPI spec — Orval can't codegen SSE. They're consumed via raw `fetch`/`ReadableStream` or `EventSource` on the client.

### AI Market Intelligence ("Market Brain")
An 11-part AI layer, all backend-only (no client-side API keys). Claude calls (`claude-sonnet-4-6`) go through `@workspace/integrations-anthropic-ai` + the shared `artifacts/api-server/src/lib/aiJson.ts` helper (`generateClaudeJson` + `asString/asStringArray/asNumber/clampInt/oneOf/extractJson` for robust JSON parsing). The in-app Assistant uses GPT (`gpt-5.4`) via `@workspace/integrations-openai-ai-server` instead.

Two rules apply to **every** AI feature in this repo:
1. Disclaimers are pinned/appended **server-side** — never trust or render the model's own disclaimer text as authoritative.
2. Every AI endpoint has a deterministic mock/fallback path so the UI never breaks when Claude/GPT or an upstream (news RSS, broker candles) is unavailable.

Self-populating endpoints (Market Brain, Assistant daily brief, daily market brief) generate lazily in the background on first GET and may return `null` initially; the client polls until the record is from *today* (UTC-day check, not "any record exists" — a stale record from yesterday must not stop polling). See `.agents/memory/ai-json-endpoints.md` and `.agents/memory/daily-brief-autogen.md` for the exact contract before adding a new one of these.

**Trade Intelligence** (Signals page, `TradeIntelligenceDialog` component + `POST /trade-intelligence/evaluate-with-claude`): a Claude-narration layer over a 9-factor score object (trend/marketStructure/liquidity/volume/volatility/news/sentiment/multiTimeframe/pattern). There is no real multi-factor scoring engine yet — `artifacts/trading-bot/src/lib/tradeIntelligenceInput.ts` bridges the existing single-timeframe MA-signal data into this shape and honestly marks unscored factors as "not yet computed" rather than inventing numbers. User-triggered (not self-populating), so no mock fallback — failure just leaves the deterministic signal score visible. See `.agents/memory/trade-intelligence-claude.md`.

### Authentication
Email+password, `bcrypt` hashing, opaque DB-backed session tokens (not JWT) in an httpOnly signed cookie (`lib/auth.ts`, `middlewares/requireAuth.ts`, `routes/auth.ts`). `routes/index.ts` mounts `healthRouter`/`authRouter` first, then `router.use(requireAuth)` gates every router mounted after that line — a new route file needs no auth wiring of its own. Frontend: `hooks/use-auth.tsx`'s `AuthProvider`/`useAuth()` wraps the generated `/auth/*` hooks; `App.tsx`'s `AppShell` renders `login.tsx`/`signup.tsx` while logged out and only mounts the real app (which fires real API queries) once a session is confirmed. See `.agents/memory/session-auth.md` for exactly what is/isn't per-tenant.

### Multi-tenant broker accounts
Every user connects their own broker via `Settings` or the Setup Wizard's first step (`POST /broker/connect`, credentials encrypted at rest — see `.agents/memory/multi-tenant-broker.md`). `botEngine.ts`/`scannerEngine.ts` are `Map<userId, State>`, not global singletons — every exported function takes a leading `userId`. `broker.ts`/`capitalcom.ts`/`trading212.ts` take explicit credentials instead of reading env vars; Capital.com's session cache is `Map<userId, Session>`. `startBot`/`executeManualTrade` throw `BrokerNotConnectedError` (→ 400) if the user has no broker connected. Live price streaming (`capitalStream.ts`) is also per-user — a ref-counted `Map<userId, CapitalStreamManager>` registry (`acquireCapitalStream`/`releaseCapitalStream`/`evictCapitalStream`), not a global singleton; see `.agents/memory/capital-streaming.md`.

### Admin Centre
Role-gated (`users.role`, no self-serve promotion — direct DB update only) customer
management at `/admin`, behind `requireAdmin` (`artifacts/api-server/src/routes/admin.ts`).
Suspending a customer (`users.suspendedAt`) blocks login/every request immediately AND
force-stops their bot + evicts their live stream (`stopBot`/`evictCapitalStream`) — not
just a login-time check. Subscriptions (`plan`/`status`/`notes`/`renewsAt`) are
admin-authored, not Stripe-driven. Contracts are base64 in Postgres (`contracts.fileData`,
10MB cap via `multer`), not object storage; upload/download are deliberately **not** in
the OpenAPI spec (same exception as SSE endpoints). See `.agents/memory/admin-centre.md`.

### Bar resolution & session gating (day-trading rebuild, Phases 1-2)
`bot_config.barResolution` (default `MINUTE_5`) controls the Capital.com candle resolution the bot, scanner,
and backtest all fetch — the scanner always mirrors the bot's setting, there is no separate scanner
resolution. `broker.ts`'s `getBrokerPriceHistory()` takes `resolution` as a **required** parameter
(deliberately not defaulted, so a future hardcode regression fails to compile). New trade entries are
blocked when Capital.com's `marketStatus` isn't `"TRADEABLE"` — this gate (`isMarketClosedForEntry`) only
ever blocks opening new exposure and fails **open** (allows the trade) on a lookup error.

**Flatten-by-close** (Phase 2): open positions are force-closed once their instrument's market is confirmed
closed, via a *separate* `isMarketClosedForFlatten` gate that fails in the **opposite** direction — closed
(leaves the position open, retries next cycle) on a lookup error, since forcing an unconfirmed close is worse
than delaying a confirmed one. Closes route through the normal `placeAndRecord()` with a new `isClose: true`
flag (skips attaching a stop-loss/take-profit, which a closing order should never carry).

**Backtest cost realism** (Phase 2): round-trip cost is auto-derived per-instrument from its live bid/offer
spread (`getBrokerQuote`), not a manual setting — `costPerTradePercent` was removed from `BotConfig`/Settings
entirely (the DB column stays, unused, per the drizzle DDL-risk note below). Backtest fills also moved to a
next-bar-close model to remove a look-ahead bug (deciding and filling on the identical bar) — see
`.agents/memory/day-trading-phase2-cost-flatten.md` for the fill-timing ordering, which is subtle and easy to
get backwards.

Further day-trading work (strategy ensemble, ATR stops, walk-forward validation gate) is still a future
phase, not done yet. See `.agents/memory/intraday-bar-resolution.md` and
`.agents/memory/day-trading-phase2-cost-flatten.md`.

### Trade execution & risk (read before touching `botEngine.ts`, `broker.ts`, or any execute route)
- Manual trades and the automated bot **must** place orders through the same path — both read broker/dryRun/stopLossPercent from that user's bot config and write the same `trades` row shape (`FILLED`/`FAILED`/`DRY_RUN`, with `userId`).
- **Dry Run is the primary money-safety switch.** Stopped bot state forces dry-run (`dryRun = cfg.dryRun || !state.running`) — a manual `/signals/run` while Stopped can never place a real order.
- Risk limits (position size cap, max concurrent positions, daily-loss circuit breaker) are enforced **in code** in `botEngine.ts`, never as LLM instructions, and are per-user (each user's `BotState` in the `botStates` Map has its own circuit breaker). When the data a limit depends on can't be read, the correct failure mode is to block new BUYs that cycle, not trade blind.
- AI trade modes (`bot.config.aiTradeMode`: `off`/`guard`/`autonomous`) let Claude review or decide trades; on any Claude error the trade is vetoed/held, never placed.
- Full detail (SELL-can-open-shorts caveat, cash-budget cap, error status codes, concurrent-position counting) is in `.agents/memory/trade-execution-safety.md` and `.agents/memory/risk-control-fail-safe.md` — read both before changing execution or risk logic.

### Other load-bearing conventions
- **Backtest cost ordering** (`artifacts/api-server/src/lib/backtest.ts`): round-trip cost must be deducted *before* the bar's equity point is pushed and drawdown updated, or the equity curve/return/drawdown numbers stop agreeing with each other. See `.agents/memory/backtest-cost-ordering.md`.
- **Capital.com streaming protocol**: plain JSON WebSocket (not Lightstreamer), reuses the REST session's CST/token, max 40 epics/connection, quote field is `ofr` not `offer`. `instrumentsTable.ticker` IS the Capital.com epic — no separate mapping layer. See `.agents/memory/capital-streaming.md`.
- **Conversation kind isolation**: Assistant and Signal Analyst chats share the `conversations`/`messages` tables, discriminated by `conversations.kind`. Every ID-based route in both routers (get/delete/list-messages/send) must filter by `(id AND kind AND userId)` — `messages` has no `userId` of its own, so message routes re-verify the parent conversation's owner first. See `.agents/memory/conversation-kind-isolation.md`.
- **Live data polling cadence**: broker-backed dashboard data (account/positions) polls at a fixed ~20s interval, not tied to the bot's scan interval — do not drop this toward sub-second polling, Capital.com/Trading 212 REST APIs are rate-limited. DB-only reads (signals, scanner) can poll faster. See `.agents/memory/live-data-refresh-cadence.md`.
- **Onboarding wizard** (`/setup`): must always pin `dryRun: true` on finish (never spread a prior live config), and the first-run redirect must gate on `!onboarded && zero instruments`, not the localStorage flag alone, or existing users get trapped. See `.agents/memory/onboarding-wizard.md`.
- **Orval codegen gotchas** beyond the path/query collision above — using a generated query hook with `enabled` requires passing an explicit `queryKey`. See `.agents/memory/orval-codegen-gotchas.md`.
