/**
 * The customer-facing plan catalogue: display names, pricing, and feature copy.
 *
 * Deliberately separate from planService.ts, which owns what a plan CAN DO
 * (the entitlement matrix the server enforces). This module owns what a plan
 * IS CALLED and COSTS — marketing can rename "Starter" to "Premium" or change
 * £9 to £12 here without touching a single entitlement check, a database enum,
 * or a migration.
 *
 * PRICING IS LAUNCH PRICING TO VALIDATE, not settled truth. The numbers were
 * chosen from the entitlement matrix and unit costs (AI queries are Claude
 * tokens; instruments are broker API load), pitched under mainstream retail
 * platforms (TradingView Essential ~£12/mo, Trade Ideas ~$89/mo) since
 * TradeBuzz is unproven. Edit freely — nothing else in the codebase depends on
 * these numbers.
 */
import type { PlanName, PlanLimits } from "./planService";
import { PLAN_LIMITS } from "./planService";

export interface PlanCatalogEntry {
  /** Customer-facing name — NOT the internal enum value. */
  displayName: string;
  tagline: string;
  /** null = "Contact us" (enterprise). 0 = free. */
  monthlyPriceGbp: number | null;
  /** Marketing copy, most compelling first. Limits are appended by the route. */
  features: string[];
  /**
   * Stripe Price id for this tier, from env so go-live is configuration.
   * null until Stripe is wired (see BILLING.md) — the UI treats null as
   * "request an upgrade" rather than "checkout".
   */
  stripePriceId: string | null;
  /** Highlight this tier in the pricing UI as the recommended choice. */
  recommended: boolean;
}

export const PLAN_CATALOG: Record<PlanName, PlanCatalogEntry> = {
  free: {
    displayName: "Free",
    tagline: "Research the markets, prove the strategies",
    monthlyPriceGbp: 0,
    features: [
      "Full backtesting on every strategy",
      "Market scanner and live charts",
      "Signals with plain-English explanations",
      "Bot runs in Dry Run — realistic practice, no real orders",
    ],
    stripePriceId: null,
    recommended: false,
  },
  starter: {
    displayName: "Starter",
    tagline: "Put the bot to work with real orders",
    monthlyPriceGbp: 9,
    features: [
      "Everything in Free",
      "Live trading — the bot places real orders",
      "Stop-loss, take-profit and daily-loss protection",
      "Trading survives restarts and deploys",
    ],
    stripePriceId: process.env.STRIPE_PRICE_STARTER || null,
    recommended: false,
  },
  pro: {
    displayName: "Pro",
    tagline: "AI in the loop on every trade",
    monthlyPriceGbp: 29,
    features: [
      "Everything in Starter",
      "AI trade modes — guard reviews every signal, autonomous decides",
      "AI trade intelligence and performance coaching",
      "Priority on new strategies and features",
    ],
    stripePriceId: process.env.STRIPE_PRICE_PRO || null,
    recommended: true,
  },
  enterprise: {
    displayName: "Enterprise",
    tagline: "For teams, prop firms and platforms",
    monthlyPriceGbp: null,
    features: [
      "Everything in Pro, uncapped",
      "Multiple seats and organisation management",
      "White-label and API access",
      "Dedicated support and onboarding",
    ],
    stripePriceId: null,
    recommended: false,
  },
};

/** Tier order for pricing displays — cheapest first. */
export const PLAN_ORDER: PlanName[] = ["free", "starter", "pro", "enterprise"];

/**
 * A catalogue entry with its enforced limits, shaped for JSON (Infinity
 * serialises as null = "Unlimited", matching GET /plan's convention).
 */
export function catalogWithLimits(plan: PlanName): PlanCatalogEntry & {
  plan: PlanName;
  limits: { [K in keyof PlanLimits]: PlanLimits[K] extends number ? number | null : PlanLimits[K] };
} {
  const limits = PLAN_LIMITS[plan];
  const cap = (n: number) => (Number.isFinite(n) ? n : null);
  return {
    plan,
    ...PLAN_CATALOG[plan],
    limits: {
      liveTrading: limits.liveTrading,
      aiTradeModes: limits.aiTradeModes,
      maxInstruments: cap(limits.maxInstruments),
      aiQueriesPerDay: cap(limits.aiQueriesPerDay),
    },
  };
}
