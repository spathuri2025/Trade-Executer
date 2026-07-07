---
name: Live price SSE store & per-epic selector (superseded)
description: Why the live-price hook used to be a shared external store — now superseded by per-ticker polling
---

# Live price feed re-render discipline

> **Superseded.** `use-live-prices.ts` no longer uses a shared SSE `EventSource` store —
> the backend's global WebSocket relay was removed in the multi-tenant broker round (see
> `.agents/memory/multi-tenant-broker.md`). It now polls `GET /quote` per ticker via
> React Query (`useQueries`/`useQuery`), which — usefully — gets the same "don't
> re-render unrelated instruments" property for free, since each ticker is its own query
> subscription. The exported hook signatures changed too: `useLivePrices(tickers: string[])`
> now takes the ticker list explicitly (it used to discover them itself from the SSE
> stream) — see `LiveTickerStrip.tsx` for the calling pattern. `useLiveQuote(epic)` is
> unchanged.

**Original problem this solved (for whoever rebuilds per-user WebSocket streaming):**
the backend pushed quotes on-change for up to 40 subscribed epics over one shared SSE
connection. A plain `useState` map re-rendered the whole consuming page on *every* tick
from *any* instrument, which starved the Charts page's own live candle update and made
the chart feel laggy/delayed. If a future per-user WebSocket redesign reintroduces a
shared multi-epic connection, it will need the same per-epic stable-reference discipline
(`useSyncExternalStore` + spreading the map but reusing unchanged epic objects) that the
old implementation used — recoverable from git history.
