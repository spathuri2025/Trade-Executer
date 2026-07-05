---
name: TradeBuzz AI JSON endpoints
description: Conventions for AI-backed endpoints in the trading-bot (Market Brain, news analysis, chart insight, performance coach, assistant brief)
---

All Claude-backed structured-JSON features in TradeBuzz go through `artifacts/api-server/src/lib/aiJson.ts` (`generateClaudeJson` + coercion helpers `asString/asStringArray/asNumber/clampInt/oneOf/extractJson`). Model is `claude-sonnet-4-6` via `@workspace/integrations-anthropic-ai` (backend only).

**Rules that hold across every AI feature here:**
- Disclaimers are pinned/appended **server-side**; never render the model's own disclaimer wording as authoritative.
- Every AI endpoint MUST have a deterministic mock/fallback path so the UI keeps working when Claude or the upstream (news RSS, broker candles) is unavailable. Market-news list returns `{items, mock:boolean}` so the client can badge sample data.
- Self-populating endpoints (`/market-brain/latest`, `/assistant/daily-brief`, plus the older `/daily-market-brief/latest`) generate in the background on first request and may return `null` initially. The client polls (5s) until the record's `createdAt` is from today (UTC), then stops. Mirror `DailyMarketBrief.tsx`'s `isFromToday` pattern for any new one.

**Why:** keeps AI cost bounded (one snapshot/brief per day), keeps the dark UI from ever showing a broken/empty state, and keeps legal disclaimers trustworthy regardless of model drift.
