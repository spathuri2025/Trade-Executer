---
name: Multi-tenant broker accounts (Round 1)
description: Per-user broker credentials, per-user bot/scanner engines, and what's deferred to a later round
---

# Multi-tenant broker accounts

Each user now connects their own broker account (Capital.com or Trading 212) and gets a
fully isolated bot — no more shared server-wide `CAPITALCOM_*`/`TRADING212_API_KEY` env
vars (removed entirely; the operator connects their own account like any customer, via
`/broker/connect`).

**Credential storage:** `broker_credentials` table, one row per user, AES-256-GCM
encrypted at rest via `artifacts/api-server/src/lib/crypto.ts` (key: `CREDENTIALS_ENCRYPTION_KEY`
env var, 32-byte hex, checked at boot in `app.ts` like `SESSION_SECRET`). Never decrypt
and return credentials to the client — `GET /broker/status` only returns a masked
identifier. `POST /broker/connect` test-calls the broker (`getBrokerAccount`) before
saving, so bad credentials are rejected immediately rather than silently persisted.

**Engine model:** `botEngine.ts`'s `state` singleton and `scannerEngine.ts`'s `state`
singleton are both now `Map<userId, State>` (`botStates`, `scannerStates`), lazily
created. Every exported function takes a leading `userId: number` param. `BotConfig` is
now persisted per-user in a `bot_config` table (previously in-memory only — with
multiple concurrent tenants, config must survive a restart or every customer's settings
vanish on redeploy). `getOrCreateBotState(userId)` loads from `bot_config` on first
access per user, falling back to the same defaults as before.

**Broker layer:** `broker.ts`/`capitalcom.ts`/`trading212.ts` no longer read
`process.env.*` — every function takes explicit credentials (`UserBrokerCredentials` /
`CapitalCredentials` / `Trading212Credentials` from `brokerCredentialsService.ts`).
Capital.com's session cache (`cachedSession`/`sessionCooldownUntil`/`sessionInFlight`) is
now `Map<userId, SessionCacheEntry>` in `capitalcom.ts` — each user gets their own
Capital.com session, not a shared one.

**All existing safety mechanics were preserved exactly, just re-scoped per user** — the
daily-loss circuit breaker, fail-closed risk gates (block new BUYs when account/positions
data is unavailable), per-cycle cash budget, forced dry-run while stopped, and the
in-flight trade dedupe lock (now keyed `${userId}:${broker}:${ticker}:${side}`). See
`.agents/memory/risk-control-fail-safe.md` and `.agents/memory/trade-execution-safety.md`
— read both before touching `runCycle`.

## Deferred to a later round (deliberate, not an oversight)

**Live price streaming.** `capitalStream.ts` and `routes/stream.ts` (the shared
Capital.com WebSocket + SSE relay) were **deleted** — they had no way to authenticate
once the global env-var credentials were removed, and a real fix means redesigning them
per-user (`Map<userId, CapitalStreamManager>`) as a dedicated project, not a patch. Fully
recoverable from git history; the non-obvious WebSocket protocol details (endpoint,
auth, `ofr` field name, 40-epic cap) are preserved in `.agents/memory/capital-streaming.md`
for whoever rebuilds this.

**Interim fallback:** `artifacts/trading-bot/src/hooks/use-live-prices.ts` now polls
`GET /quote` per ticker (via React Query, ~20s cadence — see
`.agents/memory/live-data-refresh-cadence.md`) instead of subscribing to the SSE stream.
Each ticker is its own query subscription, which incidentally solves the old store's
"don't re-render unrelated instruments" problem for free (see
`.agents/memory/live-price-store.md` for why that mattered) — no manual
`useSyncExternalStore` plumbing needed anymore.

**Scanner is Capital.com-only, unchanged.** `scannerEngine.ts`'s `fetchMarkets` still
only works for `credentials.broker === "capitalcom"` (uses Capital.com's market-search
endpoint directly) — a Trading 212–connected user's scan returns zero results. This
predates multi-tenancy and wasn't in scope to fix here.

**How to apply:** if/when per-user WebSocket streaming is rebuilt, it needs its own
`Map<userId, CapitalStreamManager>` (one upstream connection per user, subscribed to
*that user's* enabled instruments, authenticated with *that user's* Capital.com session
via `getCapitalSessionTokens(userId, credentials)`) — mirror the `botStates`/
`scannerStates` Map pattern already established.
