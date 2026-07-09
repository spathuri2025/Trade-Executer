---
name: Multi-tenant broker accounts
description: Per-user broker credentials, per-user bot/scanner/stream engines, and remaining known limitations
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

**Trading 212 live vs demo environments:** T212 API keys are environment-specific —
practice-account keys only work against `demo.trading212.com`, live keys against
`live.trading212.com`. `POST /broker/connect` auto-detects: it tries live first, then
demo, and persists the winning environment on the credential row
(`trading212_environment`, decode defaults to `"live"` for legacy rows). **Why:**
validating only against live meant every practice-account key got HTTP 400/401 at
connect. **How to apply:** never hardcode a T212 host; take it from the credential's
`environment`. A 401 on BOTH hosts means the key itself is invalid (revoked/regenerated
or truncated paste), not an environment issue.

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

**Live price streaming is now per-user too** (round 2, done — see
`.agents/memory/capital-streaming.md` and `.agents/memory/live-price-store.md`).
`capitalStream.ts` is a ref-counted `Map<userId, CapitalStreamManager>` registry
(`acquireCapitalStream`/`releaseCapitalStream`/`evictCapitalStream`), not a global
singleton. `routes/broker.ts` calls `evictCapitalStream(userId)` on both connect and
disconnect so a running manager never keeps using stale credentials.

**Chat conversations are now per-user too** (see
`.agents/memory/conversation-kind-isolation.md`) — `conversations`/`messages` were the
last shared-not-scoped tables from Round 1; that gap is closed.

## Still deferred / known limitations

**Scanner is Capital.com-only, unchanged.** `scannerEngine.ts`'s `fetchMarkets` still
only works for `credentials.broker === "capitalcom"` (uses Capital.com's market-search
endpoint directly) — a Trading 212–connected user's scan returns zero results. This
predates multi-tenancy and wasn't in scope to fix here.

**Admin centre (account/billing/contracts/usage management) has not been built yet** —
flagged by the user as a future, separate, larger initiative (likely needs its own admin
role concept and a payments provider integration for billing) — do not assume any
admin-only surface exists in the app today.
