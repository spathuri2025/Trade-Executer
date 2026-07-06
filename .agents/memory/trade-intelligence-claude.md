---
name: Trade Intelligence (Claude layer on Signals page)
description: Why the AI Trade Intelligence feature has no real multi-factor scoring engine yet, and how the endpoint stays reusable when one is built
---

`POST /trade-intelligence/evaluate-with-claude` (`artifacts/api-server/src/routes/tradeIntelligence.ts`
+ `lib/tradeIntelligenceService.ts`) is a generic Claude-narration layer: it takes a
pre-computed 9-factor score object (`trend`/`marketStructure`/`liquidity`/`volume`/
`volatility`/`news`/`sentiment`/`multiTimeframe`/`pattern`) + a risk plan + a final
score/direction/recommendation, and asks Claude to turn it into a plain-English report
(summary, bullish/bearish factors, warnings, narratives, invalidation, disclaimer). It
uses the same `generateClaudeJson`/`aiJson.ts` helpers and Replit-managed Anthropic
integration as every other AI feature — no new SDK install or API key.

**There is no real multi-factor scoring engine in this repo.** The only deterministic
scoring that exists is the single-timeframe MA-crossover signal explanation in
`signalExplanation.ts` (confidence/technicalReason/newsReason/riskLevel/suggestedAction).
The bridge `artifacts/trading-bot/src/lib/tradeIntelligenceInput.ts`
(`buildTradeIntelligenceInput`) maps a `Signal` into the 9-factor shape using only real
data (trend from MA confidence/direction, marketStructure from regime, news from
aiReason/newsReason) and marks every factor with no real data (liquidity, volume,
volatility, sentiment, multiTimeframe, pattern) as neutral score 50 with reason "Not yet
computed by TradeBuzz's scoring engine" — never fabricated numbers.

**Why:** the required system prompt says "if the setup is unclear, recommend Watchlist
or No Trade" — honestly flagging missing factors lets Claude behave correctly instead of
being fed invented data it would treat as real.

**How to apply:** if a real deterministic scoring engine (trend/liquidity/volume/pattern
recognition/etc.) is built later, only `tradeIntelligenceInput.ts`'s mapping needs to
change — the backend endpoint/service/OpenAPI contract (`TradeIntelligenceInput`/
`TradeFactorScores` schemas) is already generic and doesn't need to change. This feature
lives on the Signals page (`TradeIntelligenceDialog` component, triggered per-row), not a
standalone page — deliberately, since there's no dedicated multi-symbol scoring workflow
yet.
