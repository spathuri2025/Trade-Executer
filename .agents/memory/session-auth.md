---
name: Session authentication model
description: How TradeBuzz's login system works, and what is/isn't per-tenant now
---

# Session authentication

TradeBuzz requires a logged-in session for every route except `/healthz` and
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

**Update — as of the multi-tenant broker round, this IS now per-tenant for most data.**
See `.agents/memory/multi-tenant-broker.md` for the full picture: `instruments`/`trades`/
`signals`/`scannerResults`/`bot_config`/`broker_credentials` are all scoped by `userId`,
and `botEngine.ts`/`scannerEngine.ts` are per-user (`Map<userId, State>`), each with their
own connected broker credentials.

**Still shared/global, not per-user** (deliberate, documented, not an oversight):
- `conversations`/`messages` (Assistant + Signal Analyst chat) — no `userId` column.
  Adding one without wiring it into every query in `assistant.ts`/`signalAnalyst.ts`
  would be a half-finished, misleading change; deferred as its own follow-up.
- `userAiBriefs`, `marketBrainSnapshots`, `dailyMarketBriefs`, `marketNews`,
  `aiMarketAnalysis` — these are intentionally app-wide "market intelligence" content,
  not per-account data, so staying global is consistent with their design, not a gap.

**How to apply:** when adding a new feature, check whether it's about *the user's own
trading data* (instruments/trades/signals/bot/broker — scope by `req.user.id`, mirror the
existing route patterns) or *shared market content* (news/briefs — stays global). Don't
assume `conversations`/`messages` are private per user even though most other tables now are.
