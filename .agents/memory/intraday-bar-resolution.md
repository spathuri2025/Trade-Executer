---
name: Intraday bar resolution + session gating (day-trading Phase 1)
description: How bar resolution became configurable, and the new-entry market-status gate
---

# Intraday bar resolution + session gating

An independent tester and an "institutional advisor" review both flagged the
same root problem: the bot/scanner/backtest were hardcoded to **hourly**
Capital.com bars (`"HOUR"` resolution) with a 60-minute scan interval —
swing-trading cadence being marketed as day-trading. This was Phase 1 of a
longer day-trading rebuild roadmap (later phases — strategy ensemble, cost/
slippage realism, ATR stops, flatten-by-close, walk-forward validation — are
explicitly NOT done yet).

**The strategy math was already resolution-agnostic** (MA crossover, ADX
regime filter, RSI, Bollinger — all pure bar-count math, no time
assumptions) — the only real blocker was a single chokepoint:
`broker.ts`'s `getBrokerPriceHistory()` hardcoded `"HOUR"` with no override.

**What changed:**
- `bot_config.bar_resolution` (new column, 8-value enum matching Capital.com's
  real resolutions: `MINUTE|MINUTE_5|MINUTE_15|MINUTE_30|HOUR|HOUR_4|DAY|WEEK`,
  default `MINUTE_5`). One setting per user — the **scanner always mirrors
  the bot's resolution**, no separate scanner-resolution knob.
- `getBrokerPriceHistory()` now takes `resolution` as a **required** (not
  defaulted) parameter — deliberate, so a future hardcode regression fails to
  compile instead of silently reintroducing the same bug.
- `scannerEngine.ts`'s `runScan()` had ALSO hardcoded `"HOUR"` directly
  (bypassing `broker.ts` entirely) — fixed to read
  `botStatus.config.barResolution`, same as the bot.
- `routes/backtest.ts`'s `HISTORY_BARS = 300` stays a **fixed bar count**
  (not made resolution/session-aware, to avoid scope creep) — but the
  response now includes `barResolution`, and the frontend captions the real
  time span covered (e.g. 300 5-min bars ≈ 25 trading hours, not the ~12.5
  days it'd be at hourly) so results aren't silently misleading about sample
  window size.

**New: market-status gating on NEW entries only.** Capital.com's
`marketStatus` field (e.g. `"TRADEABLE"`, `"CLOSED"`) was already being
fetched in a couple of places but never used to gate trading. Now:
- **Bot** (`botEngine.ts`): `isMarketClosedForEntry()` calls `getBrokerQuote`
  per-instrument, only when `opensNewPosition` is true (mirrors the existing
  concurrent-position-limit gate's condition exactly) — **fails open** on a
  quote-fetch error, since this is a safety filter layered on existing risk
  gates, not itself a risk control.
- **Scanner** (`scannerEngine.ts`): reads `marketStatus` off the market data
  **already fetched** for the scan (extended the local `CapitalMarket`
  interface to capture it) rather than firing an extra quote request per
  candidate — avoids multiplying API calls during an already rate-limit-
  conscious batch scan.
- **Both gates only ever block opening new exposure — an existing position
  can always be closed/reduced regardless of market status.** This is
  Phase 1's explicit scope boundary: flatten-by-close (force-closing
  positions before session end) is a separate, later feature, not this one.

**How to apply:** any future code that fetches Capital.com price history must
pass an explicit resolution — there is no safe default to fall back on
anymore (the parameter is required specifically to force this). Any new
trade-opening path (a new AI mode, a new auto-trade surface, etc.) should
also gate through `isMarketClosedForEntry`-equivalent logic before opening
new exposure, following the same fail-open, entries-only pattern.
