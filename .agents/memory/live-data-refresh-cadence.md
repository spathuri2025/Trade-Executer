---
name: Live data refresh cadence
description: Safe polling intervals for broker-backed dashboard data and why sub-second polling is unsafe
---

# Live data refresh cadence

The dashboard/signals views poll broker + DB data on a fixed `LIVE_INTERVAL_MS`
(currently 20s), NOT tied to the bot's scan interval.

**Rule:** Do NOT wire UI refetch intervals to sub-second / "every second" polling for
broker-backed endpoints (account, positions). Keep them at ~15-30s.

**Why:** Capital.com and Trading 212 REST APIs are rate-limited, and each
account/positions call takes ~0.5-1s server-side (Capital.com also re-creates a session).
Sub-second polling overlaps requests and trips broker rate limits. Account/positions were
originally refreshed only every `intervalMinutes` (default 15 min), which felt stale — the
fix was a fixed fast-but-safe 20s cadence plus `refetchOnWindowFocus` on the query client.

**How to apply:** When asked to make the dashboard "more live", lower `LIVE_INTERVAL_MS`
toward ~10-15s and lean on `refetchOnWindowFocus`/`refetchOnReconnect`, rather than
polling every second. DB-only reads (signals, scanner results) can poll faster safely.
