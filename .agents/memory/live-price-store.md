---
name: Live price SSE store & per-epic selector
description: Why the live-price hook is a shared external store with a per-epic selector, not a plain useState hook
---

# Live price feed re-render discipline

`artifacts/trading-bot/src/hooks/use-live-prices.ts` is a **shared module-level
store** (single ref-counted `EventSource` to `/api/stream/prices`, now backed
per-user server-side — see `.agents/memory/multi-tenant-broker.md` — but this
hook needs no awareness of that, it's a plain same-origin cookie-authenticated
SSE connection) exposing two hooks:
- `useLivePrices()` — full quote map, re-renders on every tick. Use only where all
  instruments are needed (e.g. dashboard `LiveTickerStrip`).
- `useLiveQuote(epic)` — single instrument, re-renders only when that epic ticks.

**Why:** the backend pushes quotes on-change for up to 40 subscribed epics. A plain
`useState` map re-rendered the whole consuming page on *every* tick from *any*
instrument, which starved the Charts page's own live candle update and made the
chart feel laggy/delayed. Each hook call also opened its own SSE connection.

**How to apply:** for anything that only cares about one instrument, use
`useLiveQuote(epic)`. Keep the store's per-epic object references stable on updates
(spread the top-level map but reuse unchanged epic objects) so
`useSyncExternalStore` can skip renders for untouched epics. Don't revert this to a
single `useState` map — the re-render storm comes back.

**History:** this was briefly replaced with per-ticker `GET /quote` polling during
the multi-tenant broker round (when the old global-singleton WebSocket had no way
to authenticate per-user) and restored once `capitalStream.ts` became a per-user
registry. The polling approach incidentally solved the same re-render problem for
free (each ticker was its own React Query subscription) — if this ever needs to
revert to polling again for any reason, that property comes back automatically,
no extra plumbing needed.
