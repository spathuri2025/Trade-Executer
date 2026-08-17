import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: { execute: mocks.execute } }));

let checkDatabase: typeof import("./healthCheck").checkDatabase;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  ({ checkDatabase } = await import("./healthCheck"));
});

describe("checkDatabase", () => {
  it("reports ok when the query round-trips", async () => {
    mocks.execute.mockResolvedValue([{ "?column?": 1 }]);

    const result = await checkDatabase();

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports not-ok when the credentials are rejected", async () => {
    // The 17 Aug 2026 outage exactly: Postgres was reachable and answering, it
    // was refusing the login. Anything shallower than a real query missed it.
    const err = new Error('password authentication failed for user "postgres"');
    mocks.execute.mockRejectedValue(err);

    const result = await checkDatabase();

    expect(result.ok).toBe(false);
    expect(result.error).toBe(err);
  });

  it("keeps the error for logging but callers must not return it to clients", async () => {
    mocks.execute.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));
    const result = await checkDatabase();
    // The route asserts the public shape; here we only guarantee the detail is
    // available to the caller at all, so it can reach the logs.
    expect(String((result.error as Error).message)).toContain("ECONNREFUSED");
  });

  it("gives up rather than hanging when the database never answers", async () => {
    vi.useFakeTimers();
    mocks.execute.mockReturnValue(new Promise(() => {})); // never settles

    const pending = checkDatabase(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect((result.error as Error).message).toMatch(/did not respond within 3000ms/);
    vi.useRealTimers();
  });

  it("does not leave the timeout timer pending after a healthy check", async () => {
    // A stray 3s timer on every successful check would keep the event loop busy
    // and, in tests, hang the runner.
    vi.useFakeTimers();
    mocks.execute.mockResolvedValue([]);

    const result = await checkDatabase(3_000);

    expect(result.ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
