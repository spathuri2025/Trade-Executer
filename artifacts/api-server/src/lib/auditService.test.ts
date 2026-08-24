import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  failInsert: false,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if (mocks.failInsert) return Promise.reject(new Error("insert failed"));
        mocks.inserts.push(values);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        orderBy: () => ({ limit: () => Promise.resolve(mocks.rows) }),
        where: () => Promise.resolve(mocks.rows),
      }),
    }),
  },
  auditLogTable: { createdAt: "created_at" },
  usersTable: { id: "id", email: "email" },
}));

vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let audit: typeof import("./auditService");
const ACTOR = { id: 1, email: "admin@example.com" };

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.inserts = [];
  mocks.rows = [];
  mocks.failInsert = false;
  vi.resetModules();
  audit = await import("./auditService");
});

describe("recordAudit", () => {
  it("records who did what to whom", async () => {
    await audit.recordAudit(ACTOR, {
      action: "customer_deleted",
      targetUserId: 2,
      targetEmail: "victim@example.com",
      detail: "Account and all associated data permanently deleted.",
    });

    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0]).toMatchObject({
      actorUserId: 1,
      actorEmail: "admin@example.com",
      action: "customer_deleted",
      targetUserId: 2,
      targetEmail: "victim@example.com",
    });
  });

  it("stores the target email as a value, so the entry survives the account's deletion", async () => {
    // The whole point: after the user row is gone the log must still say WHO
    // was deleted, not just an orphaned id.
    await audit.recordAudit(ACTOR, { action: "customer_deleted", targetUserId: 99, targetEmail: "gone@example.com" });
    expect(mocks.inserts[0]).toMatchObject({ targetEmail: "gone@example.com" });
  });

  it("allows an entry with no target — announcements have none", async () => {
    await audit.recordAudit(ACTOR, { action: "announcement_sent", detail: '"Maintenance" sent to 3 users.' });
    expect(mocks.inserts[0]).toMatchObject({ targetUserId: null, targetEmail: null });
  });

  it("never throws — a failed audit write must not fail the action itself", async () => {
    // Better a suspension that went unlogged than an admin who cannot suspend.
    mocks.failInsert = true;
    await expect(
      audit.recordAudit(ACTOR, { action: "customer_suspended", targetUserId: 2 }),
    ).resolves.toBeUndefined();
  });
});

describe("listAudit", () => {
  it("returns entries in the shape the Admin Centre renders", async () => {
    mocks.rows = [
      {
        id: 5,
        actorEmail: "admin@example.com",
        action: "subscription_updated",
        targetEmail: "customer@example.com",
        detail: "plan: free → pro",
        createdAt: new Date("2026-08-24T07:00:00Z"),
      },
    ];

    const entries = await audit.listAudit();

    expect(entries).toEqual([
      {
        id: 5,
        actorEmail: "admin@example.com",
        action: "subscription_updated",
        targetEmail: "customer@example.com",
        detail: "plan: free → pro",
        createdAt: "2026-08-24T07:00:00.000Z",
      },
    ]);
  });
});

describe("lookupEmail", () => {
  it("returns the email when the user exists", async () => {
    mocks.rows = [{ email: "someone@example.com" }];
    expect(await audit.lookupEmail(2)).toBe("someone@example.com");
  });

  it("returns null rather than throwing for an unknown user", async () => {
    mocks.rows = [];
    expect(await audit.lookupEmail(999)).toBeNull();
  });
});
