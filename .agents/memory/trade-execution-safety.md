---
name: Trade execution safety
description: How manual and bot trade execution share config + recording, how Dry Run gates live orders, and how to classify execution errors.
---

# Trade execution safety (TradeBuzz)

Manual trades and the automated bot must place orders the SAME way. Both read
broker / dryRun / stopLossPercent from the single bot config and write a row to
the `trades` table with status `FILLED` / `FAILED` / `DRY_RUN`.

**Why:** divergence between the two paths is how a "safe" manual trade ends up
bypassing the Dry Run guard or stop-loss and sending a real order. Keep the
order-placement + DB-recording logic mirrored (manual reuses the bot's pattern).

**How to apply:**
- Dry Run ON ⇒ log + record `DRY_RUN`, never call the broker. It is the primary
  money-safety switch; surface it prominently in any execution UI (live-vs-dry
  badge + confirmation dialog).
- A broker-declared *rejection* (e.g. "market closed") is recorded as a `FAILED`
  trade and still returned 201 — the rejection reason belongs in trade history,
  not swallowed.
- Error status codes for the execute endpoint: business/input errors (empty
  ticker, non-positive amount) → 400; an identical order already in flight → 429
  (in-memory lock keyed by broker:ticker:side prevents double-click double
  orders); upstream infra failure (price fetch / broker unreachable) → 502.
- There is no auth in the app by design, so the execute endpoint is publicly
  reachable. The in-flight lock limits accidental dupes but is NOT an authz
  boundary — put login in front before exposing live trading publicly.
