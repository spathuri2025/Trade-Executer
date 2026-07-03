---
name: Daily market brief auto-generation
description: How TradeBuzz self-populates the daily market brief across dev/prod, and the polling contract it depends on
---

# Daily market brief auto-generation

The daily market brief is a DB row, and dev and production have SEPARATE databases,
so a brief generated in one environment never appears in the other. Manual admin
generation therefore only ever filled dev. Fix = each environment self-populates.

**Rule:** lazy LLM generation triggered by a read endpoint must run as a
fire-and-forget background task, NOT inline in the request.
**Why:** generation takes ~13s; awaiting it inside GET /daily-market-brief/latest
hung the page and, during that window, concurrent GETs returned null and the client
got stuck showing "not published". The GET must return immediately with whatever
exists (null or a stale brief) and kick off generation in the background.

**Rule:** the client poll predicate must stop only when it has TODAY's brief, not
when *any* brief exists.
**Why:** on a new day the DB still holds yesterday's brief; a "stop when brief
present" predicate stops polling and never picks up today's freshly generated row.
Both server (`isFromToday`, UTC day) and frontend (`isFromToday(iso)`) apply the
same UTC-day staleness check; refetchInterval polls 5s until today's brief lands.

**How to apply:** guard generation with the shared in-process `creating` flag +
`CREATE_COOLDOWN_MS`/`lastCreateAt` (set at start of background gen) so only one
runs at a time; set `Cache-Control: no-store` on the GET so polls aren't served a
cached empty response. Requires a persistent server (the bot loop keeps the Node
process warm) for fire-and-forget to complete. Changes only take effect in prod
after re-publishing.
