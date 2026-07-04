# TradeBuzz Reorganization — Replit Agent Prompt

Copy everything below into your Replit Agent chat. It's written as one big brief but feel free to split it into phases (marked below) if you'd rather ship incrementally and test as you go.

---

## Prompt

I want to reorganize and extend my TradeBuzz trading bot app. The goal is to make it **easier to use** and **focused on a small number of validated strategies** rather than many options. Please implement the following changes. Work in phases and confirm each phase works before moving to the next.

### Context on current app
- Pages: Dashboard, Trades, Signals, Scanner, Instruments, Assistant, Signal Analyst, Settings
- Current strategy: single MA crossover (short MA vs long MA, min trend strength %, scan interval)
- AI Trade Mode has 3 levels: Strategy only / Claude safety check / Claude decides
- Trades have a DRY_RUN vs live distinction and an "AI Reason" column that's currently always empty
- No backtesting, no risk limits, no onboarding flow

---

### Phase 1 — Risk controls (do this first, before anything else)

Add a **Risk Management** section to Settings with:
- `maxPositionSizePct` — max % of account value per position (default 5%)
- `maxDailyLossPct` — auto-pause the engine if daily loss exceeds this % (default 3%)
- `maxConcurrentPositions` — cap on open positions at once (default 5)
- `stopLossPct` and `takeProfitPct` — attached automatically to every trade placed by the bot (not just manual trades)
- A visible "Engine paused: daily loss limit hit" banner on the Dashboard if the circuit breaker trips, with a manual "Resume" button (not auto-resume)

These limits must apply regardless of AI Trade Mode — including "Claude decides" mode. Claude should never be able to place a trade that violates these limits; enforce them in code before order submission, not just as a prompt instruction to Claude.

### Phase 2 — Strategy consolidation

Replace the single MA-crossover-only setup with **two strategies plus a regime filter**:

1. **Trend-following** (existing MA crossover logic — keep as is)
2. **Mean-reversion** (new) — RSI or Bollinger Band based, for range-bound conditions
3. **Regime filter** — an ADX or ATR-based check that classifies each instrument as "trending" or "ranging" and routes it to the appropriate strategy automatically. Show the current regime classification per instrument somewhere visible (Instruments page or a new column on Signals).

Do **not** add more strategy options beyond these two. If there's an existing settings area implying more strategies could be added later, keep the code extensible but the UI should only expose these two plus the regime filter toggle.

### Phase 3 — Backtesting / performance panel

Add a new page or Dashboard section showing, per strategy and per instrument:
- Win rate
- Average win / average loss
- Max drawdown
- Total trades taken
- A simple equity curve chart (can use a lightweight charting library already available in the stack)

This should run against historical data already being pulled for the scanner/signals, so it's re-using existing data pipes rather than requiring a new data source. Make this visible before a user turns on any live automation — this is the evidence for "is this strategy actually working."

### Phase 4 — Onboarding wizard

Add a single guided setup flow for new users (a modal or dedicated first-run page) that replaces having to visit Instruments, Scanner, and Settings separately:
1. Step 1: Pick instruments to track (reuse existing Instruments logic)
2. Step 2: Pick a risk preset — **Conservative / Balanced / Aggressive** — each preset sets `maxPositionSizePct`, `stopLossPct`, `takeProfitPct`, and min trend strength together. Include an "Advanced" expand option to edit raw values.
3. Step 3: Pick AI Trade Mode (Strategy only / Claude safety check / Claude decides) with a one-line plain-English explanation of what each means, generated to be understandable to a non-technical user
4. Step 4: Review and Start Engine

After completion, this flow shouldn't block access to the individual pages — power users can still go tune things page by page. It's a fast path, not a replacement.

### Phase 5 — Unified activity feed

Add a single live feed (could live on the Dashboard, top of page) that merges what's currently split across Scanner, Signals, and Trades into one chronological stream:
- Scan run → Signal generated → Claude review (if applicable) → Trade executed/skipped

Each entry should be collapsible/expandable for detail rather than requiring navigation to a different page. Keep the existing individual pages (Scanner, Signals, Trades) intact for users who want the detailed views — this feed is additive, not a replacement.

### Phase 6 — Fill in the AI Reason column

Every trade influenced by Claude (Claude safety check or Claude decides mode) should have its `AI Reason` field populated with a short (1-2 sentence) explanation of why Claude approved/blocked/placed the trade. This should be stored at execution time, not generated retroactively, and should be visible in both the Trades history and the new unified activity feed.

### Phase 7 — Separate dry-run from live trades visually

In the Trades history table, add a clear visual separation (e.g. a filter toggle or grouped sections) between DRY_RUN and live trades so a user can never mistake one for the other at a glance.

---

### Claude's role — implementation notes

Please make sure the code reflects this division of responsibility clearly:

- **Claude safety check mode**: Claude receives the strategy's proposed signal + relevant context (position, recent price action, any news/volatility data available) and returns approve/block + a short reason. Claude does not decide trade parameters — it only vetoes or allows what the strategy already proposed.
- **Claude decides mode**: Claude has full discretion on entry/exit but is still bound by the Phase 1 risk limits enforced in code, and must return a reason string that gets logged.
- **Regime filter**: this can optionally be assisted by Claude reading recent price context, but should have a non-AI fallback (ADX/ATR threshold) so the app doesn't depend on an LLM call for basic strategy routing.
- **Onboarding copy and backtesting summaries**: use Claude to generate the plain-English explanations shown in the onboarding wizard and any strategy performance summaries, but keep the underlying numbers computed deterministically in code, not by Claude.

---

### What NOT to do
- Don't add more than 2 strategies
- Don't let Claude bypass risk limits in any mode
- Don't remove the existing individual pages (Scanner, Signals, Trades, Instruments) — the new feed and wizard are additive
- Don't auto-resume the engine after a circuit-breaker pause — require manual resume

Please confirm your plan for Phase 1 before writing code, then proceed phase by phase.
