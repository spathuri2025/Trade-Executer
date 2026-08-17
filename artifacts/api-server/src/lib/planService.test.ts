import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mock surface for planService's only dependency (the DB). `joinRows` feeds the
 * users⋈subscriptions lookup behind getEffectivePlan; `usageRows` feeds the
 * ai_usage lookup behind getAiQuotaUsage.
 */
const mocks = vi.hoisted(() => ({
  joinRows: [] as Array<{
    role: string;
    createdAt: Date;
    plan: string | null;
    status: string | null;
    renewsAt?: Date | null;
  }>,
  usageRows: [] as Array<{ count: number }>,
}));

/** Before the grandfathering cutoff — an account that predates enforcement. */
const LEGACY = new Date("2026-01-01T00:00:00Z");
/** After the cutoff — a signup since enforcement launched. */
const NEW_SIGNUP = new Date("2026-09-01T00:00:00Z");

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        // getEffectivePlan: .from().leftJoin().where()
        leftJoin: () => ({ where: () => Promise.resolve(mocks.joinRows) }),
        // getAiQuotaUsage: .from().where()
        where: () => Promise.resolve(mocks.usageRows),
      }),
    }),
  },
  usersTable: { id: "id", role: "role", createdAt: "created_at" },
  subscriptionsTable: { userId: "user_id", plan: "plan", status: "status" },
  aiUsageTable: { userId: "user_id", day: "day", count: "count" },
}));

// Keep everything real except the comparison helpers, which would otherwise
// try to introspect the mocked (column-less) tables above.
vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
}));

const { getEffectivePlan, getPlanLimits, getAiQuotaUsage, PLAN_LIMITS, utcDayKey } = await import("./planService");

const USER_ID = 1;

beforeEach(() => {
  mocks.joinRows = [];
  mocks.usageRows = [];
});

describe("getEffectivePlan — entitlement is not simply subscriptions.plan", () => {
  it("gives admins the top tier regardless of their subscription row", async () => {
    // The operator must never be able to lock themselves out of their own
    // product by mis-setting (or never setting) their own row.
    mocks.joinRows = [{ role: "admin", createdAt: NEW_SIGNUP, plan: null, status: null }];
    expect(await getEffectivePlan(USER_ID)).toBe("enterprise");

    mocks.joinRows = [{ role: "admin", createdAt: NEW_SIGNUP, plan: "free", status: "canceled" }];
    expect(await getEffectivePlan(USER_ID)).toBe("enterprise");
  });

  it("treats a post-launch signup with no subscription row as free", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: null, status: null }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
  });

  it("honours an entitling status", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "pro", status: "active" }];
    expect(await getEffectivePlan(USER_ID)).toBe("pro");

    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "starter", status: "trialing" }];
    expect(await getEffectivePlan(USER_ID)).toBe("starter");
  });

  it("downgrades a lapsed subscription to free even though the row still says 'pro'", async () => {
    // This is what finally gives past_due/canceled teeth — before enforcement
    // they were decorative labels in the Admin Centre.
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "pro", status: "past_due" }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");

    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "enterprise", status: "canceled" }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
  });

  it("fails closed to free for an unknown user id", async () => {
    mocks.joinRows = [];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
  });
});

describe("no grandfathering — signup date never grants entitlements", () => {
  // A migration-era rule once granted 'pro' to accounts created before
  // enforcement shipped. TradeBuzz now runs on a fresh database with no legacy
  // users, so that rule was removed — these guard against it creeping back and
  // silently handing out free Pro accounts.
  it("gives an old account with no subscription row 'free', not 'pro'", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: LEGACY, plan: null, status: null }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
  });

  it("treats old and new accounts identically when neither has a subscription", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: LEGACY, plan: null, status: null }];
    const oldAccount = await getEffectivePlan(USER_ID);
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: null, status: null }];
    const newAccount = await getEffectivePlan(USER_ID);
    expect(oldAccount).toBe(newAccount);
    expect(newAccount).toBe("free");
  });

  it("still honours an explicitly granted plan on an old account", async () => {
    // Removing grandfathering must not stop a real, admin-set subscription
    // from working.
    mocks.joinRows = [{ role: "customer", createdAt: LEGACY, plan: "pro", status: "active" }];
    expect(await getEffectivePlan(USER_ID)).toBe("pro");

    mocks.joinRows = [{ role: "customer", createdAt: LEGACY, plan: "pro", status: "canceled" }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
  });
});

describe("subscription expiry — renewsAt finally has teeth", () => {
  const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const NEXT_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  it("lapses an active subscription whose renewsAt has passed", async () => {
    // The revenue leak this closes: before this check a month sold was a
    // lifetime granted — renewsAt was stored and displayed but never read.
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "pro", status: "active", renewsAt: YESTERDAY }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
  });

  it("lapses an expired trial", async () => {
    // status=trialing + renewsAt=trial end is the whole trial mechanism; the
    // lapse must happen by itself, with no admin action and no cron job.
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "pro", status: "trialing", renewsAt: YESTERDAY }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
  });

  it("honours a subscription whose renewsAt is still in the future", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "starter", status: "active", renewsAt: NEXT_MONTH }];
    expect(await getEffectivePlan(USER_ID)).toBe("starter");
  });

  it("treats a null renewsAt as never expiring", async () => {
    // Comped / admin-granted accounts: leave the date blank and they keep the
    // plan until someone changes the row.
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "pro", status: "active", renewsAt: null }];
    expect(await getEffectivePlan(USER_ID)).toBe("pro");
  });

  it("keeps the admin override even with an expired row", async () => {
    mocks.joinRows = [{ role: "admin", createdAt: NEW_SIGNUP, plan: "pro", status: "active", renewsAt: YESTERDAY }];
    expect(await getEffectivePlan(USER_ID)).toBe("enterprise");
  });

  it("resolves limits through expiry too — an expired pro gets free limits", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "pro", status: "active", renewsAt: YESTERDAY }];
    expect(await getPlanLimits(USER_ID)).toEqual(PLAN_LIMITS.free);
  });
});

describe("PLAN_LIMITS", () => {
  it("locks live trading and AI trade modes behind a paid plan", async () => {
    expect(PLAN_LIMITS.free.liveTrading).toBe(false);
    expect(PLAN_LIMITS.free.aiTradeModes).toBe(false);
    // Starter buys live trading but not the AI modes — the upsell to Pro.
    expect(PLAN_LIMITS.starter.liveTrading).toBe(true);
    expect(PLAN_LIMITS.starter.aiTradeModes).toBe(false);
    expect(PLAN_LIMITS.pro.aiTradeModes).toBe(true);
  });

  it("resolves limits through the same effective-plan rules", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "pro", status: "past_due" }];
    // Lapsed pro gets FREE limits, not pro limits.
    expect(await getPlanLimits(USER_ID)).toEqual(PLAN_LIMITS.free);
  });
});

describe("AI quota", () => {
  it("reports usage against the plan's daily allowance", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "free", status: "active" }];
    mocks.usageRows = [{ count: 4 }];

    const quota = await getAiQuotaUsage(USER_ID);
    expect(quota.used).toBe(4);
    expect(quota.limit).toBe(PLAN_LIMITS.free.aiQueriesPerDay);
    expect(quota.allowed).toBe(true);
  });

  it("reports not-allowed once usage reaches the limit", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "free", status: "active" }];
    mocks.usageRows = [{ count: PLAN_LIMITS.free.aiQueriesPerDay }];

    expect((await getAiQuotaUsage(USER_ID)).allowed).toBe(false);
  });

  it("treats a day with no row as zero used", async () => {
    mocks.joinRows = [{ role: "customer", createdAt: NEW_SIGNUP, plan: "free", status: "active" }];
    mocks.usageRows = [];

    const quota = await getAiQuotaUsage(USER_ID);
    expect(quota.used).toBe(0);
    expect(quota.allowed).toBe(true);
  });

  it("buckets usage by UTC calendar day", async () => {
    // The reset boundary users are told about ("midnight UTC") must not drift
    // with the server's local timezone.
    expect(utcDayKey(new Date("2026-08-14T23:59:59Z"))).toBe("2026-08-14");
    expect(utcDayKey(new Date("2026-08-15T00:00:00Z"))).toBe("2026-08-15");
  });
});
