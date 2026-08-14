import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mock surface for planService's only dependency (the DB). `joinRows` feeds the
 * users⋈subscriptions lookup behind getEffectivePlan; `usageRows` feeds the
 * ai_usage lookup behind getAiQuotaUsage.
 */
const mocks = vi.hoisted(() => ({
  joinRows: [] as Array<{ role: string; plan: string | null; status: string | null }>,
  usageRows: [] as Array<{ count: number }>,
}));

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
  usersTable: { id: "id", role: "role" },
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
    mocks.joinRows = [{ role: "admin", plan: null, status: null }];
    expect(await getEffectivePlan(USER_ID)).toBe("enterprise");

    mocks.joinRows = [{ role: "admin", plan: "free", status: "canceled" }];
    expect(await getEffectivePlan(USER_ID)).toBe("enterprise");
  });

  it("treats a user with no subscription row as free (new signups)", async () => {
    mocks.joinRows = [{ role: "customer", plan: null, status: null }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
  });

  it("honours an entitling status", async () => {
    mocks.joinRows = [{ role: "customer", plan: "pro", status: "active" }];
    expect(await getEffectivePlan(USER_ID)).toBe("pro");

    mocks.joinRows = [{ role: "customer", plan: "starter", status: "trialing" }];
    expect(await getEffectivePlan(USER_ID)).toBe("starter");
  });

  it("downgrades a lapsed subscription to free even though the row still says 'pro'", async () => {
    // This is what finally gives past_due/canceled teeth — before enforcement
    // they were decorative labels in the Admin Centre.
    mocks.joinRows = [{ role: "customer", plan: "pro", status: "past_due" }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");

    mocks.joinRows = [{ role: "customer", plan: "enterprise", status: "canceled" }];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
  });

  it("fails closed to free for an unknown user id", async () => {
    mocks.joinRows = [];
    expect(await getEffectivePlan(USER_ID)).toBe("free");
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
    mocks.joinRows = [{ role: "customer", plan: "pro", status: "past_due" }];
    // Lapsed pro gets FREE limits, not pro limits.
    expect(await getPlanLimits(USER_ID)).toEqual(PLAN_LIMITS.free);
  });
});

describe("AI quota", () => {
  it("reports usage against the plan's daily allowance", async () => {
    mocks.joinRows = [{ role: "customer", plan: "free", status: "active" }];
    mocks.usageRows = [{ count: 4 }];

    const quota = await getAiQuotaUsage(USER_ID);
    expect(quota.used).toBe(4);
    expect(quota.limit).toBe(PLAN_LIMITS.free.aiQueriesPerDay);
    expect(quota.allowed).toBe(true);
  });

  it("reports not-allowed once usage reaches the limit", async () => {
    mocks.joinRows = [{ role: "customer", plan: "free", status: "active" }];
    mocks.usageRows = [{ count: PLAN_LIMITS.free.aiQueriesPerDay }];

    expect((await getAiQuotaUsage(USER_ID)).allowed).toBe(false);
  });

  it("treats a day with no row as zero used", async () => {
    mocks.joinRows = [{ role: "customer", plan: "free", status: "active" }];
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
