---
name: QA round 1 — Scanner, Daily Briefing, Live Prices, account labels
description: Root causes and fixes for four bugs a tester found across the platform
---

# QA round 1 fixes

**Scanner returning 0 instruments/0 hits silently** (`scannerEngine.ts`): the
market-discovery call was `GET /markets?searchTerm=&instrumentTypes=X&limit=Y`.
Capital.com's `/markets` endpoint only documents `searchTerm`/`epics` as real
filters — `instrumentTypes`/`limit` aren't real query params, and an
explicitly-empty `searchTerm=` gets treated as "match nothing" rather than "no
filter" (omitting all params is what returns the full list, per their docs).
Fixed by calling `/markets` with no query params (`fetchAllMarkets`) and
filtering/capping to `instrumentTypes`/`maxInstrumentsPerScan` client-side using
the `instrumentType` field each returned market already carries.

**Assistant Daily Briefing showing wrong account/watchlist state** — this was a
real cross-account bug, not staleness: `userAiBriefsTable` had no `userId`
column, so the whole platform shared ONE row per day, generated from whichever
customer happened to trigger it first. A previous memory note had wrongly
lumped this in with genuinely-global content (`dailyMarketBriefs`,
`marketNews`, etc.) — it isn't; it's grounded in the requesting user's own
account via `buildTradingContext`, so it must be per-user. Fixed by adding
`userId` to the schema and moving `routes/assistantBrief.ts`'s
generation-cooldown state from module-level globals to per-user
`Map`/`Set` (same pattern as `botEngine.ts`/`scannerEngine.ts`). See
`.agents/memory/session-auth.md` for the corrected shared-vs-per-user list.

**Live Prices showing "—" forever for shares outside market hours**: not a bug
in the traditional sense — Capital.com genuinely has no live quote for a share
outside exchange hours (confirmed: Capital.com's own site shows the same
gap). The real gap was UX: the WebSocket stream (`capitalStream.ts`) never
pushes an update for such an epic at all — no "closed" signal on the wire,
just silence — so `LiveTickerStrip` showed an unexplained blank dash forever.
Fixed two things: (1) `getCapitalQuote` was discarding `marketStatus` whenever
bid/offer were missing and throwing a generic error instead — now it only
throws when the whole snapshot is missing, and preserves `marketStatus` with
`bid`/`offer` defaulted to 0 otherwise (this also fixes the Trades page's
existing but previously-unreachable "Market Closed" badge logic). (2)
`LiveTickerStrip`/`TickerTile` now falls back to the REST `GET /quote`
endpoint (30s poll, `retry: false`) only when the WS has no data for that
ticker yet, and shows "Market closed" instead of a bare dash when
`marketStatus !== "TRADEABLE"`.

**Account numbers "not reconciling"**: also not a bug — `total = invested +
result` holds exactly (Capital.com semantics: `invested` maps from
`balance.deposit`, `result` from `balance.profitLoss`, `total` from
`balance.balance`). The AI wasn't told this relationship, so given labels like
"Cash available" and "Invested" it reasonably (but wrongly) assumed
`cash + invested` should sum to `total` — cash is Capital.com's `available`
margin figure, an unrelated, independently-can-go-negative number, not part of
that sum. Fixed `buildTradingContext` (`assistantContext.ts`) to explicitly
state the real relationship and instruct the model never to describe these as
inconsistent. Also relabeled the dashboard's "Invested" stat to "Deposited
Funds" for the same reason (`pages/dashboard.tsx`).

**How to apply:** `account.invested`/`account.cash` are NOT interchangeable
with "money currently in open trades" — `invested` (Capital.com's `deposit`)
is closer to base equity, `cash` (`available`) is free margin. Any new UI or
AI context surfacing these must not imply they sum together with `total` in
any way other than `total = invested + result`. For any Capital.com endpoint
returning `marketStatus` alongside possibly-missing bid/offer, preserve
`marketStatus` rather than discarding it behind a generic "unavailable" error —
it's the only way callers can tell "market closed" from "genuinely broken."
