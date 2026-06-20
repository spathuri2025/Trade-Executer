---
name: Drizzle push named-conflict on shared dev DB
description: Why drizzle-kit push hangs with a TTY prompt and how to get a clean push
---

`drizzle-kit push` (and `push --force`) abort with "Interactive prompts require a TTY terminal" via `promptNamedWithSchemasConflict` / `tablesResolver` when the target database already contains tables that don't match the current schema. Drizzle can't decide whether each unfamiliar table is a new create or a rename, so it tries to prompt — which fails in the non-interactive Replit shell. `--force` does NOT resolve this; it only auto-answers data-loss warnings, not the named-conflict resolver.

**Why:** the Replit dev database is shared/persistent and can carry tables from a previous app/setup that have nothing to do with the new schema.

**How to apply:** when the new app owns the schema and there is no real data to preserve (e.g. broker API blocked in dev so nothing real was ever written), list `public` tables, `DROP TABLE ... CASCADE` the stale ones, then run a plain `push` — it becomes a clean set of creates with no prompt. If real data exists, write a proper migration instead of dropping.
