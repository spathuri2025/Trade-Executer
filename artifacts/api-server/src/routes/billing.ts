import express, { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

/**
 * Stripe billing — SKELETON ONLY, deliberately not live.
 *
 * Pricing isn't validated yet, so no Stripe account exists and nothing here
 * makes a Stripe call. The route exists now so that go-live is configuration
 * plus ~30 lines (see BILLING.md for the exact steps), not an architecture
 * change: the schema already has stripeCustomerId/stripeSubscriptionId, the
 * catalogue already reads STRIPE_PRICE_* env vars, and this route is already
 * mounted at the right place with the right body handling.
 *
 * Mounted BEFORE requireAuth in routes/index.ts: Stripe calls this endpoint
 * server-to-server with no session cookie. Authentication is the webhook
 * signature, which is why the raw body matters — express.json() would consume
 * and re-serialise the payload, and signature verification checks the exact
 * bytes Stripe sent. That is also why this router applies express.raw() ONLY
 * to its own path instead of relying on the app-wide JSON parser.
 */
const router: IRouter = Router();

function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

router.post("/billing/webhook", express.raw({ type: "application/json" }), (req, res): void => {
  if (!billingConfigured()) {
    // Loud in the logs, quiet to the caller. If Stripe is ever pointed here
    // before the env vars are set, this is the breadcrumb.
    logger.error("Stripe webhook received but billing is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET unset)");
    res.status(503).json({ error: "Billing is not configured" });
    return;
  }

  // ---- GO-LIVE IMPLEMENTATION (see BILLING.md) ----------------------------
  // 1. Verify the signature against the raw body:
  //      const event = stripe.webhooks.constructEvent(
  //        req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  //    Return 400 on verification failure.
  // 2. Handle the three events that matter:
  //      checkout.session.completed        -> resolve userId from session.client_reference_id,
  //                                           upsert subscriptions row: plan from the price id
  //                                           (match against PLAN_CATALOG stripePriceId),
  //                                           status "active", renewsAt = period end,
  //                                           store stripeCustomerId/stripeSubscriptionId.
  //      customer.subscription.updated     -> update status + renewsAt (renewals extend it;
  //                                           payment failure sets past_due).
  //      customer.subscription.deleted     -> status "canceled".
  //    planService's renewsAt check then handles lapse with no further work.
  // 3. Always 200 promptly on handled/ignored events — Stripe retries non-2xx.
  // -------------------------------------------------------------------------
  logger.warn("Stripe webhook handler not implemented — event ignored");
  res.status(501).json({ error: "Webhook handling not implemented" });
});

export default router;
