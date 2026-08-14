-- One-off backfill: grandfather every EXISTING user onto an active `pro` plan.
--
-- WHY: plan enforcement treats "no subscription row" as `free`, and free
-- accounts cannot place real orders. Without this, the moment enforcement
-- ships every current user -- including anyone running a live bot with real
-- money -- would silently drop to dry-run.
--
-- RUN THIS *BEFORE* DEPLOYING ENFORCEMENT, against the PRODUCTION database
-- (Replit's Database panel has a SQL runner -- use that rather than pasting a
-- connection string anywhere). Writing these rows is a no-op against the
-- currently-deployed code, since nothing reads the table yet. That ordering is
-- what gives a zero-downgrade window.
--
-- SAFE TO RE-RUN: ON CONFLICT DO NOTHING leaves any existing row untouched,
-- including accounts you have deliberately set to `free`.
--
-- Users who sign up AFTER this runs get no row, and so correctly start on
-- `free` -- which is the whole point of the paywall.

INSERT INTO subscriptions (user_id, plan, status, notes, updated_at)
SELECT id, 'pro', 'active', 'Grandfathered on launch of plan enforcement', NOW()
FROM users
ON CONFLICT (user_id) DO NOTHING;

-- Verify: every row should show plan='pro', status='active'.
--   SELECT u.email, s.plan, s.status
--   FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
--   ORDER BY u.id;
