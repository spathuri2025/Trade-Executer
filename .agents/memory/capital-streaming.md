---
name: Capital.com live streaming
description: Non-obvious facts about Capital.com's streaming WebSocket used for live TradeBuzz prices
---

# Capital.com streaming WebSocket

> **Status: implementation removed.** `capitalStream.ts`/`routes/stream.ts` (the
> singleton WS manager + SSE relay this doc describes) were deleted in the multi-tenant
> broker round — they had no way to authenticate once credentials became per-user. Fully
> recoverable from git history. The protocol facts below remain accurate and are exactly
> what a per-user rebuild (`Map<userId, CapitalStreamManager>`) needs — see
> `.agents/memory/multi-tenant-broker.md` for what that rebuild should look like.
> `getCapitalSessionTokens()` now takes `(userId, credentials, forceRefresh?)`, not the
> bare `(forceRefresh?)` shown below.

- Endpoint is a **plain JSON WebSocket** at `wss://api-streaming-capital.backend-capital.com/connect` — NOT Lightstreamer (a common wrong assumption). Confirmed against Capital.com docs + a working connection.
- Auth reuses the **same CST + X-SECURITY-TOKEN** minted by the existing REST `/session` login — no separate streaming credential. Session lives ~10 min, so ping (`destination: "ping"`) at <10 min and refresh tokens on reconnect.
- Subscribe with `marketData.subscribe` `{ payload: { epics: [...] } }`, **max 40 epics per connection**. Server replies with a `marketData.subscribe` message whose `payload.subscriptions` maps epic→`"PROCESSED"`/error. Quotes arrive as `destination: "quote"` `{ epic, bid, ofr, timestamp }` (note `ofr`, not `ofer`/`offer`). `OHLCMarketData.subscribe` exists for candles.
- Free with existing creds; push-on-change (NOT a fixed 1s cadence) — market must be open. On weekends US-stock epics send nothing, so the UI shows placeholders.

**Why it matters:** the market/epic identifier throughout TradeBuzz IS `instrumentsTable.ticker` (the ticker column stores the Capital.com EPIC), and `broker.ts` uses tickers directly as epics — so streaming, quotes, and history all key off the same value with no mapping layer.

**How to apply:** when adding any Capital.com data feed, reuse `getCapitalSessionTokens()` from `capitalcom.ts`; don't invent a new auth path. Serialize any subscription-diff logic (single-flight) since multiple SSE clients can trigger it concurrently and race on shared subscribed-set state.
