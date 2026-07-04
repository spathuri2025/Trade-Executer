# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

TradeBuzz — algorithmic trading bot dashboard (ClinAITech Limited, UK). Brokers: Trading 212 + Capital.com. MA-crossover strategy with a market scanner. "Obsidian Noir" dark theme.

Pages: Dashboard, Trades, Signals, Scanner, Performance, Instruments, **Charts** (live candlesticks), **Assistant** (AI day-trading chat), Signal Analyst, **Setup Wizard**, Settings.

### Live Charts
Dedicated Charts page (`/charts`, `artifacts/trading-bot/src/pages/charts.tsx`, nav "Charts", `CandlestickChart` lucide icon) with instrument + resolution selectors. Candlestick chart via TradingView **lightweight-charts v5** (`artifacts/trading-bot/src/components/CandlestickChart.tsx`), seeded with historical OHLC from Capital.com and overlaid with live streaming ticks.
- Backend: `getCapitalCandles(epic, resolution, count)` in `capitalcom.ts` returns OHLC `{time(unix secs), open, high, low, close}` (mid of bid/ask per field; `snapshotTime` is UTC-without-suffix so a `Z` is appended before parsing). Route `GET /api/candles?epic=&resolution=&count=` (`routes/candles.ts`, registered as `candlesRouter`), 400 if epic missing, 502 on upstream error, resolution whitelisted.
- OpenAPI: `Candle` schema + `/candles` path (epic is a **query** param, not path — a path param + query params made Orval emit two colliding `GetCandlesParams`). Consumed via generated `useGetCandles` hook (pass explicit `queryKey` when using `enabled`).
- Live overlay: `useLivePrices()` (epic == `instrument.ticker`); the chart merges each tick into the current forming candle and **rolls over to a new candle at interval boundaries**, anchoring new candle times to the historical bar grid (`last.time + k*duration`) rather than epoch-aligned buckets. Quote timestamps normalised ms→sec.
- lightweight-charts v5 API: `chart.addSeries(CandlestickSeries, opts)` (not v4's `addCandlestickSeries`); `chart.remove()` on unmount. Chart wrapper uses a **fixed pixel height** (not `height:100%`/flex) because the page's height chain doesn't resolve, which collapsed the canvas to a thin strip.

### Onboarding Setup Wizard
Guided first-run flow at `/setup` (`artifacts/trading-bot/src/pages/setup.tsx`, nav "Setup Wizard", Rocket icon). Additive — does not remove any existing page; all pages stay directly reachable.
- 4 steps: (1) add instruments (reuses instrument hooks), (2) risk preset Conservative/Balanced/Aggressive (sets maxPositionSizePercent/stopLossPercent/takeProfitPercent + minTrendStrength together, plus riskPerTrade/maxDailyLoss/maxConcurrent) with an Advanced raw-edit toggle, (3) AI trade mode off/guard/autonomous, (4) review + Start Engine.
- On finish: `updateBotConfig` (spreads current config, overrides risk fields + aiTradeMode, **always pins `dryRun: true`** — never inherits a live setting), `updateScannerConfig` (minTrendStrength lives on ScannerConfig, not BotConfig), then `startBot`, then sets the onboarded flag.
- First-run detection: `useOnboarding` (`artifacts/trading-bot/src/hooks/use-onboarding.ts`, localStorage `tradebuzz_onboarded`). App.tsx redirects to `/setup` **only** for a genuinely fresh install (flag unset AND zero instruments) so existing users are never force-redirected. Not a security boundary.

### AI Trade Execution (guard / autonomous)
Claude can participate in the bot's trade loop via a user-selectable **AI Trade Mode** (`bot.config.aiTradeMode`: `"off" | "guard" | "autonomous"`, default `"off"`). Selected in Settings (`settings.tsx`, mode selector card with a dry-run warning banner). Reasoning is surfaced on the Signals page (AI Reason) and Trades page (AI Reason + confidence).
- **guard** (safety-check): MA strategy generates the signal; on a non-HOLD signal Claude's `reviewSignal()` approves/vetoes before the real order is placed. On Claude error the trade is **vetoed** (fail-safe).
- **autonomous** (decision-maker): Claude's `decideTrades()` decides BUY/SELL/HOLD per instrument each cycle, then the bot acts.
- Logic: `artifacts/api-server/src/lib/aiTrader.ts` (`reviewSignal`, `decideTrades`) using Claude `claude-sonnet-4-6` via `@workspace/integrations-anthropic-ai` (backend-only, JSON parse w/ recovery, mirrors `dailyBriefService`). Wired into `botEngine.ts` `runCycle` (gathers account+positions+per-instrument MA contexts; helpers `sizePosition()`, `placeAndRecord()` persist `aiReason`/`aiConfidence`).
- DB: `trades.aiReason`+`trades.aiConfidence`, `signals.aiReason` (all text, nullable). Exposed via OpenAPI (Trade/Signal/BotConfig schemas) and returned by the `/trades`, `/signals`, `/signals/run` route mappings.
- **Safety**: bot defaults Stopped + `dryRun` TRUE; DRY_RUN trades are paper only. Capital.com places REAL orders against the LIVE API when dryRun is off — keep dry run on until validated.

### Live Streaming Prices
Real-time price ticker fed by Capital.com's own free streaming WebSocket (user chose this over Binance/Finnhub). Push-on-change, not a fixed 1s cadence.
- Backend: `artifacts/api-server/src/lib/capitalStream.ts` — singleton EventEmitter WS manager to `wss://api-streaming-capital.backend-capital.com/connect` (PLAIN JSON, **not** Lightstreamer). Auth reuses CST + X-SECURITY-TOKEN from the existing REST `/session` (`getCapitalSessionTokens(forceRefresh)` in `capitalcom.ts`). Subscribes enabled instrument epics (`marketData.subscribe`, max 40, ordered by `instrumentsTable.id` for a stable subset), keeps a latest-quote Map, pings every 9min (session lives 10min), reconnects with backoff + forced token refresh. `syncSubscriptions()` is single-flight (guards against concurrent SSE-connect races diffing stale state). Emits `quote` + `status`.
- Relay: `artifacts/api-server/src/routes/stream.ts` — SSE `GET /api/stream/prices` (initial snapshot event, forwards quote/status, 15s heartbeat, removes listeners + clears heartbeat on `req.close`). Registered in `routes/index.ts` as `streamRouter`. **Not** in the OpenAPI spec — SSE isn't codegen'd by Orval, consumed via raw `EventSource` on the client (same pattern as assistant chat).
- Frontend: `use-live-prices.ts` (EventSource hook → epic→quote map + connected flag) + `LiveTickerStrip.tsx` (per-instrument tiles, mid price, up/down flash, bid/ask, connection dot) at the top of `dashboard.tsx`.
- **epic == `instrument.ticker`** — the ticker column stores the Capital.com EPIC directly; `broker.ts` uses tickers as epics too, so no mapping layer. Closed markets (weekends) simply show "—" / "waiting".

### Daily Market Brief
Dashboard panel "AI Daily Market Brief" (`artifacts/trading-bot/src/components/DailyMarketBrief.tsx`) showing the latest AI-generated daily outlook for Crude Oil WTI, Gold, S&P 500, Bitcoin. Each market card has bias, key support/resistance, news/events, high-risk periods, technical observations, educational summary, plus a shared disclaimer footer.
- Backend: `artifacts/api-server/src/routes/dailyMarketBrief.ts` (GET `/api/daily-market-brief/latest` → `{ brief }` or `{ brief: null }`; POST `/api/daily-market-brief/create` generates via Claude, saves, returns). Generation logic in `artifacts/api-server/src/lib/dailyBriefService.ts`.
- LLM: Claude `claude-sonnet-4-6` via Replit Anthropic AI Integrations (`@workspace/integrations-anthropic-ai`), backend-only, no API key in frontend. The exact analyst prompt is the source of truth in `dailyBriefService.ts`; a JSON-format instruction is appended so the response parses into structured per-market fields.
- DB: `daily_market_briefs` table (`lib/db/src/schema/dailyMarketBriefs.ts`), markets stored as jsonb.
- **Admin mode** is a client-only `localStorage` flag (`useAdminMode`, toggle in Settings) gating the "Generate Today's Brief" button. NOT a security boundary — the app has no auth yet, so the create endpoint is publicly reachable.

### Signal Analyst
Separate in-app chat page (`/signal-analyst`) that gives plain, short, simple trade feedback for a non-expert reader (no external API key).
- Backend: `artifacts/api-server/src/routes/signalAnalyst.ts` (conversation CRUD + Claude SSE streaming), context/prompt in `artifacts/api-server/src/lib/signalAnalystContext.ts` (plain-language analyst system prompt, grounded with `buildTradingContext()` reused from `assistantContext.ts`).
- LLM: Claude `claude-sonnet-4-6` via Replit Anthropic managed proxy (`@workspace/integrations-anthropic-ai`), system prompt passed as the top-level `system` field; backend-only, no API key in frontend.
- Output: **plain prose**, not JSON. The prompt instructs short, everyday-language answers (bottom line first, main reason, biggest risk; no jargon/walls of text). The frontend renders the streamed text directly and shows a "Thinking…" spinner only until the first token arrives. (Historical note: an earlier version returned a structured JSON contract rendered as an `AnalysisCard`; that was removed in favour of plain language at the user's request.)
- Disclaimer enforced server-side (`ensureDisclaimer`) + permanent UI footer, same as the Assistant.
- **Conversation isolation**: Assistant and Signal Analyst share the `conversations`/`messages` tables, discriminated by the `conversations.kind` column (`'assistant'` vs `'signal_analyst'`). Every conversation-ID route in BOTH routers (get/delete/list-messages/send) filters by `(id AND kind)` so the two chats cannot read/write/delete each other's data.

### AI Assistant
In-app chat assistant (`/assistant`) that does technical analysis, risk review, and strategy feedback grounded in the user's live data (bot config, broker account/positions, watchlist, recent trades/signals/scanner hits).
- Backend: `artifacts/api-server/src/routes/assistant.ts` (conversation CRUD + SSE streaming chat), context builder in `artifacts/api-server/src/lib/assistantContext.ts`.
- LLM via Replit OpenAI AI Integrations proxy (`@workspace/integrations-openai-ai-server`), model `gpt-5.4`. No API key needed.
- The risk / not-financial-advice disclaimer is a **hard requirement**: enforced server-side (`ensureDisclaimer` appends it if the model omits it) AND shown as a permanent footer in the chat UI.
- SSE is consumed on the client via `fetch` + `ReadableStream` (Orval cannot generate SSE hooks); conversation list/messages use generated hooks.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
