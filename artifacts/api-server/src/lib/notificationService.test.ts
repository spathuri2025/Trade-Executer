import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  /** Rows inserted into notifications, in order. */
  notificationInserts: [] as Array<Record<string, unknown>>,
  /** Rows the users table select returns (recipients / email lookup). */
  userRows: [] as Array<{ id?: number; email?: string }>,
  /** Whether the notifications insert should fail (channel-independence test). */
  failNotificationInsert: false,
  email: { sendEmail: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: (table: { __name?: string }) => ({
      values: (values: Record<string, unknown>) => {
        if (table?.__name === "notifications") {
          if (mocks.failNotificationInsert) return Promise.reject(new Error("insert failed"));
          mocks.notificationInserts.push(values);
          return Promise.resolve();
        }
        // announcements insert — needs .returning()
        const p = Promise.resolve() as Promise<void> & { returning: () => Promise<unknown[]> };
        p.returning = () => Promise.resolve([{ id: 42, ...values }]);
        return p;
      },
    }),
    select: () => ({
      from: () => ({ where: () => Promise.resolve(mocks.userRows) }),
    }),
  },
  notificationsTable: { __name: "notifications" },
  announcementsTable: { __name: "announcements" },
  usersTable: { id: "id", email: "email", suspendedAt: "suspended_at" },
}));

vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
}));

vi.mock("./email", () => mocks.email);
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let service: typeof import("./notificationService");

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.notificationInserts = [];
  mocks.userRows = [];
  mocks.failNotificationInsert = false;
  mocks.email.sendEmail.mockResolvedValue(true);

  vi.resetModules();
  service = await import("./notificationService");
});

describe("notifyUser", () => {
  it("inserts an in-app notification and emails the user", async () => {
    mocks.userRows = [{ email: "user@example.com" }];

    await service.notifyUser(7, {
      type: "support_reply",
      title: "New reply",
      body: "We got back to you.",
      link: "/inbox",
    });

    expect(mocks.notificationInserts).toHaveLength(1);
    expect(mocks.notificationInserts[0]).toMatchObject({
      userId: 7,
      type: "support_reply",
      title: "New reply",
      link: "/inbox",
    });
    expect(mocks.email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com", subject: expect.stringContaining("New reply") }),
    );
  });

  it("defaults the link to /inbox", async () => {
    mocks.userRows = [{ email: "user@example.com" }];
    await service.notifyUser(7, { type: "announcement", title: "t", body: "b" });
    expect(mocks.notificationInserts[0]).toMatchObject({ link: "/inbox" });
  });

  it("never throws when the email provider fails", async () => {
    // The circuit-breaker path calls this from inside a live trading cycle —
    // Resend being down must not break the halt it is reporting.
    mocks.userRows = [{ email: "user@example.com" }];
    mocks.email.sendEmail.mockRejectedValue(new Error("resend down"));

    await expect(
      service.notifyUser(7, { type: "circuit_breaker", title: "t", body: "b" }),
    ).resolves.toBeUndefined();
    expect(mocks.notificationInserts).toHaveLength(1); // in-app still delivered
  });

  it("still attempts the email when the in-app insert fails — channels are independent", async () => {
    mocks.failNotificationInsert = true;
    mocks.userRows = [{ email: "user@example.com" }];

    await expect(
      service.notifyUser(7, { type: "support_reply", title: "t", body: "b" }),
    ).resolves.toBeUndefined();
    expect(mocks.email.sendEmail).toHaveBeenCalled();
  });

  it("skips the email quietly for an unknown user", async () => {
    mocks.userRows = [];
    await service.notifyUser(999, { type: "support_reply", title: "t", body: "b" });
    expect(mocks.email.sendEmail).not.toHaveBeenCalled();
  });
});

describe("broadcastAnnouncement", () => {
  it("creates the announcement and fans out to every recipient", async () => {
    // The users select is called once for recipients, then once per notifyUser
    // email lookup; returning the same rows for each is fine for this shape.
    mocks.userRows = [
      { id: 1, email: "a@example.com" },
      { id: 2, email: "b@example.com" },
      { id: 3, email: "c@example.com" },
    ];

    const result = await service.broadcastAnnouncement("Maintenance", "Sunday 2am", 1);

    expect(result.announcementId).toBe(42);
    expect(result.recipients).toBe(3);
    expect(mocks.notificationInserts).toHaveLength(3);
    expect(mocks.notificationInserts.map((n) => n["userId"])).toEqual([1, 2, 3]);
    expect(mocks.notificationInserts[0]).toMatchObject({ type: "announcement", title: "Maintenance" });
  });

  it("one failed recipient does not stop the rest of the fan-out", async () => {
    mocks.userRows = [
      { id: 1, email: "a@example.com" },
      { id: 2, email: "b@example.com" },
    ];
    mocks.email.sendEmail
      .mockRejectedValueOnce(new Error("bad address"))
      .mockResolvedValue(true);

    const result = await service.broadcastAnnouncement("Title", "Body", 1);

    expect(result.recipients).toBe(2);
    expect(mocks.notificationInserts).toHaveLength(2);
  });
});
