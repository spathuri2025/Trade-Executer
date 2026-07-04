---
name: Risk-control fail-safe rule
description: How the trading bot enforces hard risk limits in code and why they must fail closed
---

# Risk controls must be enforced in code and fail closed

TradeBuzz's risk limits (per-position size cap, max concurrent positions, daily-loss
circuit breaker) are enforced in the bot execution path (`botEngine.ts` `runCycle`),
NOT in LLM prompts. Prompt-only "limits" are not real limits.

**Rule:** When the data a limit depends on cannot be read, block NEW entries (BUYs)
that cycle instead of trading blind.
- Per-position size cap and daily-loss breaker both need account equity — if the
  account fetch returns null and either limit is enabled, skip BUYs.
- Max-concurrent-positions needs the live positions list — if that fetch fails and
  the limit is enabled, skip BUYs.
- SELLs (closing trades) are always allowed since they only reduce exposure.

**Why:** An earlier version continued with `positions = []` / `account = null` on
fetch failure, which silently bypassed the caps and could open positions with no
enforcement. A risk control that weakens itself exactly when data is missing is
worse than none.

**How to apply (concurrent counting):** Count DISTINCT open positions by ticker
(a Set of tickers), not raw array length or per-order counters. Adding to an
already-open ticker does not consume a new position slot; only a brand-new ticker
does. Note `getBrokerPositions()` has no side/direction field, so all open
positions count toward the cap (conservative, which is the safe direction).

**SELL is NOT reduce-only in this bot.** The MA signal / Claude decision emits
directional BUY/SELL and a SELL opens a SHORT on Capital.com. So the concurrent-cap
AND fail-closed gates must apply to ANY order that opens a new distinct ticker
(gate on "opens a new position", not on side). Only the per-cycle cash-budget
check is BUY-specific (shorts don't deploy cash the same way). A BUY-only gate
lets the bot exceed the position cap via shorts.

**Daily-loss breaker:** baseline is the first equity observed each UTC day
(`utcDayKey()`); on trip it calls `stopBot()` and requires explicit `resumeBot()`
(POST /bot/resume) — never auto-resumes.
