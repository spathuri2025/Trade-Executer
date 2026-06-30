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

Pages: Dashboard, Trades, Signals, Scanner, Instruments, **Assistant** (AI day-trading chat), Settings.

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
