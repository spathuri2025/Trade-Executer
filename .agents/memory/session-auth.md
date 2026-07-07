---
name: Session authentication model
description: How TradeBuzz's login system works, what it does and does not isolate, and why
---

# Session authentication

TradeBuzz now requires a logged-in session for every route except `/healthz` and
`/auth/*` (signup/login/logout/me) — enforced by a single `requireAuth` middleware
mounted in `artifacts/api-server/src/routes/index.ts` right after those public routers,
before every other router. Adding a new top-level router file does not require touching
it for auth — anything mounted after that line is already gated.

**Model:** email + password, `bcrypt` hashing (`lib/auth.ts`), opaque random session
tokens (not JWT) in a `sessions` table, referenced by an httpOnly `signed` cookie
(`tb_session`) via `cookie-parser` + `SESSION_SECRET`. Chosen over JWT because sessions
need to be revocable immediately (logout, forced logout on a compromised account).
`SESSION_SECRET` is a required env var (`app.ts` throws on boot if unset), same tier as
`DATABASE_URL`.

**What this does NOT do — read before assuming per-user data isolation exists:**
Only `users`/`sessions` were added. `instruments`/`trades`/`signals`/`scannerResults`/
`conversations`/`messages`/`userAiBriefs`/bot config are all still a single shared
dataset — `botEngine.ts` remains the pre-existing global in-memory singleton (one bot
loop, one broker connection). Any two logged-in users see and can control the exact same
bot, trades, and chat conversations. This was a deliberate scope decision, not an
oversight: true multi-tenant isolation needs `botEngine.ts`/`broker.ts`/`capitalStream.ts`
re-architected from a global singleton into a per-tenant model (isolated state, isolated
broker credentials, isolated intervals) — a much larger, separate project.

**Why `conversations`/`userAiBriefs` weren't scoped by user despite being named/shaped
per-user:** adding a `userId` column without wiring it into every query in
`assistant.ts`/`signalAnalyst.ts` would be a half-finished, misleading change (a column
that does nothing). Wiring it in touches the SSE streaming routes and is better done as
its own deliberate follow-up once this auth layer is live and tested, not bundled into
introducing auth itself.

**How to apply:** if/when per-tenant bot isolation is built, `botEngine.ts`'s `state`
singleton needs to become keyed by `userId` (e.g. `Map<userId, BotState>`), and
`instruments`/`trades`/`signals`/`scannerResults` need a `userId` column each, mirroring
this same pattern. Until then, do not assume any table other than `users`/`sessions` is
private to the logged-in user making the request.
