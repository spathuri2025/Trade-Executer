---
name: Day-trading rebuild Phase 2 — cost realism + flatten-by-close
description: Live-spread backtest cost, next-bar-fill slippage fix, and market-close position auto-flatten
---

# Phase 2 — cost realism + flatten-by-close

Phase 1 shipped configurable intraday bars + new-entry market-status gating.
This round covers the next two items: backtest cost realism, and
"no position held past session close."

**`NormalizedPosition` gained `direction: "BUY"|"SELL"`** (`broker.ts`) —
closing a position requires knowing which side to close with, which the
type previously discarded even though Capital.com's raw data has it
(`p.position.direction`). Trading 212 hardcodes `direction: "BUY"` — its
Invest/ISA API has no shorting and no direction field of its own, so every
T212 position is structurally long (a documented assumption, not a
quantity-sign guess).

**Flatten-by-close** (`botEngine.ts`'s `runCycle`): reuses Phase 1's
`marketStatus` mechanism via a NEW `isMarketClosedForFlatten` helper —
deliberately separate from `isMarketClosedForEntry` because the two fail in
**opposite directions**. Entry gating fails open (allow) on a quote error;
flatten gating fails **closed** (leave the position open, retry next cycle)
on a quote error, since forcing an unconfirmed close is worse than delaying
a confirmed one. The position fetch was restructured to keep the raw
`NormalizedPosition[]` first, run the flatten loop against it (mutating out
successfully-closed tickers), *then* derive `PositionSnapshot[]`/
`liveTickers` from the post-flatten list — both existing `liveTickers`
construction sites inherit the correct state for free. Closes route through
the existing `placeAndRecord()`, same as every other order, so dry-run/
failure/retry behavior is inherited, not reimplemented. Runs once, before
the `aiTradeMode` branch-split (it's a risk control, not a trading decision),
after the circuit breaker's early-return (a tripped breaker already means
"stop trading" — flattening would be MORE aggressive than the breaker's own
designed behavior, so it correctly does not run in that state).

**`placeAndRecord` gained an `isClose?: boolean` param** — a real gap caught
during implementation, not in the original plan: the function always
attached the configured stop-loss/take-profit to every order. A closing
order must never carry a new stop-loss, since there's no resulting position
left to protect. `isClose: true` skips that attachment.

**Backtest cost realism** (`routes/backtest.ts`): per-instrument, fetches a
live quote via `getBrokerQuote` and derives `costPct = (offer-bid)/price`,
replacing the old manually-typed `costPerTradePercent` setting entirely
(field removed from `BotConfig`/`BotConfigInput`/Settings UI — see below).
Fails open to `costPct=0` (frictionless) on a quote error — informational,
not a risk control, so degrading beats dropping the instrument. Trading 212
has no live-quote endpoint, so its backtests consistently show 0% cost, a
known broker limitation surfaced in the UI copy. `costPct` moved from
`BacktestReport` (report-level) to `BacktestResult` (per-row) — no
report-level average, since blending e.g. tight FX spreads with wide CFD
spreads would be actively misleading.

**Next-bar-fill slippage fix** (`backtest.ts`): fixed a real look-ahead bug
— the strategy previously decided AND filled a position flip using the
*same* bar's close. Fixed with a `pendingTarget` one-bar-deferred fill.
**Ordering matters and is easy to get backwards**: mark-to-market must run
BEFORE the fill in each iteration, using the still-pre-flip `position` —
the position queued for a flip was still the one actually held through that
whole bar (the fill happens at the bar's close, not its start). Flipping
`position` first and marking-to-market after would incorrectly credit that
bar's move to a position that was only just entered at that exact close,
i.e. had zero elapsed exposure. Caught this exact bug via a hand-verified
test case (see `backtest.test.ts`) before it shipped — the first draft
(fill-then-mark) produced a ~+50% return where the correct answer is ~0%.
The `backtest-cost-ordering.md` invariant (cost deducted before the equity
point is pushed) is preserved — only the call-site/timing of `position`
mutation changed, `book()` itself is untouched.

**`cost_per_trade_percent` column left in place but unused** — per
`drizzle-push-quirk.md`, avoided unforced DDL risk. Removed from the
`BotConfig` TS interface, `DEFAULT_CONFIG`, and `rowToConfig()`'s mapping in
`botEngine.ts`; the Drizzle schema/DB column is untouched (has a default,
so existing/new rows are unaffected, just no longer read). A future round
can `DROP COLUMN` once this is proven safe in production.

**How to apply:** any new order-placement path must decide whether it's
opening/adding exposure (needs an entry-style gate, fails open on lookup
errors) or closing/reducing it (needs a flatten-style gate if session-aware,
fails closed on lookup errors, and must pass `isClose: true` to
`placeAndRecord` so it doesn't pick up a stray stop-loss). Any change to
`backtest.ts`'s fill-timing logic needs a hand-verified test case first —
the ordering of mark-to-market vs. fill execution is subtle and this file
has a history of getting it wrong on the first pass.
