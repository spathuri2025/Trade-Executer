import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TEST_USER_ID = 1;

/**
 * Scanner-side mirror of botEngine.test.ts. Everything scannerEngine touches at
 * import time is replaced so the restart/persistence behaviour can be exercised
 * with no real network or database.
 */
const mocks = vi.hoisted(() => ({
  /** Rows `scanner_config` would return. */
  scannerConfigRows: [] as Array<Record<string, unknown>>,
  /** Every `running` value written via persistScannerRunning, in order. */
  runningWrites: [] as boolean[],
  /** Config objects written via persistScannerConfig, in order. */
  configWrites: [] as Array<Record<string, unknown>>,
  credentials: { getUserBrokerCredentials: vi.fn() },
  plan: { getPlanLimits: vi.fn() },
}));

/** A Promise that also exposes the Drizzle chain methods the engine calls. */
function insertResult() {
  const p = Promise.resolve() as Promise<void> & { onConflictDoUpdate: () => Promise<void> };
  p.onConflictDoUpdate = () => Promise.resolve();
  return p;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => Promise.resolve(table?.__name === "scanner_config" ? mocks.scannerConfigRows : []),
      }),
    }),
    insert: (table: { __name?: string }) => ({
      values: (values: Record<string, unknown>) => {
        if (table?.__name === "scanner_config") mocks.configWrites.push(values);
        return insertResult();
      },
    }),
    update: () => ({
      set: (values: { running?: boolean }) => ({
        where: () => {
          if (typeof values.running === "boolean") mocks.runningWrites.push(values.running);
          return Promise.resolve();
        },
      }),
    }),
  },
  scannerResultsTable: { __name: "scanner_results" },
  scannerConfigTable: { __name: "scanner_config", userId: "user_id", running: "running" },
}));

// Keep everything from drizzle-orm except the comparators, which are called with
// mocked (column-less) tables. No-ops avoid drizzle inspecting the columns.
vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}));

vi.mock("./broker", () => ({ placeBrokerOrder: vi.fn(), getBrokerAccount: vi.fn() }));
vi.mock("./capitalcom", () => ({ capitalAuthFetch: vi.fn(), getCapitalPriceHistory: vi.fn() }));
vi.mock("./strategyRouter", () => ({ routeStrategy: vi.fn(), requiredBars: () => 30 }));
vi.mock("./botEngine", () => ({ getBotStatus: vi.fn() }));
vi.mock("./brokerCredentialsService", () => mocks.credentials);
vi.mock("./planService", () => mocks.plan);
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let engine: typeof import("./scannerEngine");

/** A scanner_config row as the database would return it, defaulting to running. */
function buildRow(userId: number, patch: Record<string, unknown> = {}) {
  return {
    id: userId,
    userId,
    scanEnabled: true,
    autoTrade: false,
    minTrendStrength: 0.3,
    scanIntervalMinutes: 60,
    instrumentTypes: ["SHARES"],
    maxInstrumentsPerScan: 40,
    running: true,
    updatedAt: new Date(),
    ...patch,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.scannerConfigRows = [];
  mocks.runningWrites = [];
  mocks.configWrites = [];

  // Null credentials make runScan return immediately after its credential check,
  // so `getUserBrokerCredentials` call count is a clean probe for "a scan started"
  // without needing to mock the whole Capital.com market walk.
  mocks.credentials.getUserBrokerCredentials.mockResolvedValue(null);

  vi.resetModules();
  engine = await import("./scannerEngine");
});

afterEach(async () => {
  for (const id of [TEST_USER_ID, 7, 8]) {
    try {
      await engine.stopScanner(id);
    } catch {
      /* ignore */
    }
  }
});

describe("scanner config survives a restart", () => {
  it("loads persisted settings instead of silently resetting to defaults", async () => {
    // The second half of the old bug: settings were memory-only, so every deploy
    // quietly reverted each customer's scanner to the stock configuration.
    mocks.scannerConfigRows = [
      buildRow(TEST_USER_ID, {
        running: false,
        minTrendStrength: 0.75,
        scanIntervalMinutes: 15,
        maxInstrumentsPerScan: 5,
        instrumentTypes: ["COMMODITIES"],
      }),
    ];

    const status = await engine.getScannerStatus(TEST_USER_ID);

    expect(status.config.minTrendStrength).toBe(0.75);
    expect(status.config.scanIntervalMinutes).toBe(15);
    expect(status.config.maxInstrumentsPerScan).toBe(5);
    expect(status.config.instrumentTypes).toEqual(["COMMODITIES"]);
  });

  it("persists defaults for a user who has never configured the scanner", async () => {
    mocks.scannerConfigRows = [];
    await engine.getScannerStatus(TEST_USER_ID);
    expect(mocks.configWrites).toHaveLength(1);
    expect(mocks.configWrites[0]).toMatchObject({ userId: TEST_USER_ID, autoTrade: false });
  });

  it("records the intent on start and on stop", async () => {
    await engine.startScanner(TEST_USER_ID);
    expect(mocks.runningWrites).toContain(true);

    mocks.runningWrites = [];
    await engine.stopScanner(TEST_USER_ID);
    expect(mocks.runningWrites).toEqual([false]);
  });

  it("saves a config change without starting or stopping the loop", async () => {
    // persistScannerConfig and persistScannerRunning are deliberately separate:
    // a settings save must never be able to flip the loop on or off.
    await engine.updateScannerConfig(TEST_USER_ID, { minTrendStrength: 0.9 });

    expect(mocks.configWrites.at(-1)).toMatchObject({ minTrendStrength: 0.9 });
    expect(mocks.runningWrites).toEqual([]);
    expect((await engine.getScannerStatus(TEST_USER_ID)).running).toBe(false);
  });
});

describe("resumeRunningScanners — scanners survive a restart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-arms a scanner whose saved state says running", async () => {
    mocks.scannerConfigRows = [buildRow(7)];

    const { resumed, skipped } = await engine.resumeRunningScanners();

    expect(resumed).toBe(1);
    expect(skipped).toBe(0);
    expect((await engine.getScannerStatus(7)).running).toBe(true);
  });

  it("reports nothing to do when no scanner was running", async () => {
    mocks.scannerConfigRows = [];
    expect(await engine.resumeRunningScanners()).toEqual({ resumed: 0, skipped: 0 });
  });

  it("does not scan the instant it resumes, but does once the stagger elapses", async () => {
    // A scan walks Capital.com's entire market list, so restoring several at once
    // would be markedly worse than the bot's lighter cycle.
    mocks.scannerConfigRows = [buildRow(7)];
    await engine.resumeRunningScanners();

    expect(mocks.credentials.getUserBrokerCredentials).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.credentials.getUserBrokerCredentials).toHaveBeenCalledTimes(1);
  });

  it("spaces multiple scanners out instead of starting them together", async () => {
    mocks.scannerConfigRows = [buildRow(7), buildRow(8)];
    await engine.resumeRunningScanners();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.credentials.getUserBrokerCredentials).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.credentials.getUserBrokerCredentials).toHaveBeenCalledTimes(2);
  });

  it("never claims a scanner is running just because the database says it was", async () => {
    // Same invariant as the bot: only the resume path may set the in-memory flag,
    // because it is the only one that also arms the timer. A status read that
    // trusted the column would show RUNNING with nothing scheduled.
    mocks.scannerConfigRows = [buildRow(7)];

    expect((await engine.getScannerStatus(7)).running).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.credentials.getUserBrokerCredentials).not.toHaveBeenCalled();
  });

  it("cancels the pending first scan if the scanner is stopped during the stagger", async () => {
    mocks.scannerConfigRows = [buildRow(7)];
    await engine.resumeRunningScanners();

    await engine.stopScanner(7);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(mocks.credentials.getUserBrokerCredentials).not.toHaveBeenCalled();
  });

  it("restores autoTrade as saved rather than inventing it", async () => {
    // autoTrade decides whether scan hits become real orders. A restart must
    // neither silently enable it nor silently discard a user's choice.
    mocks.scannerConfigRows = [buildRow(7, { autoTrade: true })];
    await engine.resumeRunningScanners();

    expect((await engine.getScannerStatus(7)).config.autoTrade).toBe(true);
  });
});
