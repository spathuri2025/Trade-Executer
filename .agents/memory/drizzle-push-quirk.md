---
name: drizzle push false-diff quirk
description: Why `pnpm --filter @workspace/db run push` dies on an interactive prompt and how to apply schema changes anyway
---

# drizzle-kit push false-diff quirk

`pnpm --filter @workspace/db run push` (drizzle-kit 0.31.x) currently always prompts
"add instruments_user_id_ticker_unique unique constraint … truncate instruments?" and
then crashes with "Interactive prompts require a TTY" in the agent shell — **even though
that unique constraint already exists in the dev DB** (verified in `pg_constraint`,
contype `u`, matching the schema's `unique().on(userId, ticker)`). It is a drizzle-kit
introspection false diff, not a real pending change.

**How to apply schema changes despite it:** apply the specific DDL manually against the
dev DB via `executeSql` (e.g. `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`), after
verifying it matches the Drizzle schema exactly. Do NOT answer the truncate prompt with
`--force` — that risks truncating the instruments table.

**Production:** never run DDL against prod. Replit's Publish flow diffs dev schema vs
prod and applies changes automatically on republish (see the `database` skill).
