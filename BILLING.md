# Billing — Stripe go-live guide

Stripe is **prepared but not live**. Everything that makes wiring it a
configuration exercise already exists:

| Piece | Where | State |
|---|---|---|
| Plan catalogue with price-id env lookup | `artifacts/api-server/src/lib/planCatalog.ts` | done |
| `stripeCustomerId` / `stripeSubscriptionId` columns | `lib/db/src/schema/subscriptions.ts` | done (nullable, unused) |
| Webhook route, raw-body, mounted pre-auth | `artifacts/api-server/src/routes/billing.ts` | skeleton — 503 until configured, handler steps written as comments |
| Expiry enforcement (`renewsAt` lapses to free) | `artifacts/api-server/src/lib/planService.ts` | done — webhook only needs to keep `renewsAt` fresh |
| Env var placeholders | `render.yaml` | commented out |

Until then, upgrades are manual: user clicks "Request upgrade" → request appears
in the Admin Centre → payment collected however you like → admin sets
plan/status/renewsAt on the customer.

## Go-live steps (~1 day)

1. **Stripe account** (stripe.com) — business details, bank account for payouts.
2. **Products & prices**: create two products (Starter, Pro) with monthly GBP
   prices matching `planCatalog.ts` (or change the catalogue to match). Copy the
   two `price_...` ids.
3. **Env vars in Render** (uncomment in `render.yaml`, set values in the
   dashboard): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`.
4. **Webhook endpoint** in the Stripe dashboard:
   `https://www.tradebuzz.co.uk/api/billing/webhook`, events
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. The signing secret is `STRIPE_WEBHOOK_SECRET`.
5. **Implement the handler** — the steps are written as comments in
   `routes/billing.ts` (verify signature → map price id to plan via the
   catalogue → upsert the subscriptions row with status + renewsAt + Stripe ids).
   Use plain `fetch` against Stripe's REST API or add the `stripe` SDK — if
   adding the SDK, remember the lockfile is installed `--frozen-lockfile` on
   Render, so commit the updated lockfile.
6. **Checkout**: add `POST /billing/checkout` (authed) that creates a Stripe
   Checkout Session with `client_reference_id = req.user.id` and the tier's
   price id, returning the session URL. The pricing page already branches on
   `stripePriceId !== null` — swap the request-upgrade button for a redirect to
   the session URL.
7. **Customer portal** (optional, recommended): `POST /billing/portal` creating
   a portal session so customers manage cards/cancellation themselves.
8. **Test in Stripe test mode first** — test keys, test webhook, `4242 4242
   4242 4242`. Confirm: paying creates/updates the subscriptions row; cancelling
   sets `canceled`; a lapsed `renewsAt` drops access (already enforced).

## Design decisions already made

- **The subscriptions table is the source of truth, not Stripe.** The webhook
  *writes* to it; entitlement always reads from it via `getEffectivePlan`. The
  app keeps working (and admins can still hand-grant plans) if Stripe is down.
- **Manual and Stripe-managed subscriptions coexist**: rows with null Stripe ids
  are admin-authored; rows with ids are webhook-managed. The Admin Centre keeps
  working for comps, enterprise deals and fixes.
- **No entitlement logic in the webhook.** It only records facts (plan, status,
  period end). Lapsing is `planService`'s job, which is why there is no cron.
