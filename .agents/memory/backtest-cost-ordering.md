---
name: Backtest cost/equity ordering
description: Why round-trip cost must be booked before the bar's equity point is recorded and drawdown tracked in the strategy backtester.
---

In `artifacts/api-server/src/lib/backtest.ts`, when a round-trip cost is charged on a
position close, the deduction MUST happen **before** that bar's equity point is pushed to
`equityCurve` and before drawdown is updated for the bar. The final close after the loop
must likewise re-run drawdown tracking and overwrite the last equity-curve point.

**Why:** If cost is deducted after `equityCurve.push(...)` / drawdown update (the original
bug), the curve shows pre-cost equity while `totalReturnPct` is post-cost, and
`maxDrawdownPct` understates true risk — directly contradicting the documented claim that
"equity curve / return / drawdown are all net of costs". Verified: a nonzero cost both
lowers the last equity point to match net return exactly and increases max drawdown.

**How to apply:** Keep the per-bar order = mark-to-market → decide signal → flip/book
(cost) → trackDrawdown() → push equity point. avgWin/avgLoss stay GROSS on purpose so the
expectancy formula's terms read cleanly; cost is only ever a separate subtracted term.
