import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NormalizedAccount, NormalizedPosition } from "./broker";
import type { BotConfig } from "./botEngine";

const TEST_USER_ID = 1;

/**
 * Shared mock surface for botEngine's dependencies. Everything botEngine touches
 * at import time (the DB pool, broker HTTP clients, the AI trader, the pino
 * logger, broker credential lookup) is replaced so the risk-control logic can
 * be exercised in isolation with no real network, DB, or side effects.
 */
const mocks = vi.hoisted(() => ({
  enabledInstruments: [] as Array<{ ticker: string; enabled: boolean }>,
  /**
   * Rows bot_config would return. Only resumeRunningBots reads them; every other
   * select in botEngine goes through `enabledInstruments`, so the mock picks by
   * which table was passed to `.from()`.
   */
  botConfigRows: [] as Array<Record<string, unknown>>,
  /** Rows the trades table returns: the daily cap and the re-entry cooldown both read it. */
  recentTrades: [] as Array<{ ticker: string; side: string; executedAt: Date }>,
  /** Persisted equity baselines, as a restarted process would load them. */
  equityBaselines: [] as Array<Record<string, unknown>>,
  /** Every row written to the trades table, in order — opens and closes alike. */
  tradeInserts: [] as Array<Record<string, unknown>>,
  /** Every row written to the signals table — carries the reason a trade was skipped. */
  signalInserts: [] as Array<Record<string, unknown>>,
  /** Every `running` value written via persistRunning, in order. */
  runningWrites: [] as boolean[],
  broker: {
    getBrokerAccount: vi.fn(),
    getBrokerPositions: vi.fn(),
    getBrokerPriceHistory: vi.fn(),
    getBrokerQuote: vi.fn(),
    placeBrokerOrder: vi.fn(),
    getBrokerTransactions: vi.fn(),
    closeBrokerPosition: vi.fn(),
  },
  ma: { computeMASignal: vi.fn() },
  ai: { reviewSignal: vi.fn(), decideTrades: vi.fn() },
  credentials: { getUserBrokerCredentials: vi.fn() },
  plan: { getPlanLimits: vi.fn() },
  notify: { notifyUser: vi.fn() },
  /**
   * Ownership lease. Defaults to "we own everything" so the tests written before
   * leases existed keep exercising the same paths; the lease tests override
   * these per case.
   */
  lease: {
    acquireLease: vi.fn(),
    renewLease: vi.fn(),
    holdsLease: vi.fn(),
    releaseLease: vi.fn(),
    releaseAllLeases: vi.fn(),
    // botEngine re-exports this from engineLease, so the mock must provide it.
    EngineOwnedElsewhereError: class EngineOwnedElsewhereError extends Error {},
    INSTANCE_ID: "test-instance",
    LEASE_TTL_MS: 90_000,
    LEASE_RENEW_MS: 30_000,
  },
}));

/** A Promise that also exposes the extra Drizzle chain methods botEngine calls. */
function insertResult<T>(returningValue: T[] = []) {
  const p = Promise.resolve() as Promise<void> & {
    onConflictDoUpdate: () => Promise<void>;
    returning: () => Promise<T[]>;
  };
  p.onConflictDoUpdate = () => Promise.resolve();
  p.returning = () => Promise.resolve(returningValue);
  return p;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          // Tables the engine reads for its own bookkeeping answer separately:
          // returning the instrument list for every table made the trade-cap
          // and cooldown queries count instruments.
          if (table?.__name === "bot_config") return Promise.resolve(mocks.botConfigRows);
          if (table?.__name === "trades") return Promise.resolve(mocks.recentTrades);
          if (table?.__name === "equity_baselines") return Promise.resolve(mocks.equityBaselines);
          return Promise.resolve(mocks.enabledInstruments);
        },
      }),
    }),
    insert: (table: { __name?: string }) => ({
      values: (values: Record<string, unknown>) => {
        // The trades table is the one honest record of what the engine did:
        // an OPEN goes through placeBrokerOrder and a CLOSE through the
        // broker's close-by-deal call, but both write a row here. Assertions
        // read this rather than one of the two broker mocks, so a test says
        // what happened rather than which mechanism carried it.
        if (table?.__name === "trades") mocks.tradeInserts.push(values);
        if (table?.__name === "signals") mocks.signalInserts.push(values);
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
    delete: () => ({ where: () => Promise.resolve() }),
  },
  instrumentsTable: { __name: "instruments" },
  tradesTable: { __name: "trades" },
  signalsTable: { __name: "signals" },
  equityBaselinesTable: { __name: "equity_baselines", userId: "user_id" },
  botConfigTable: { __name: "bot_config", userId: "user_id", running: "running" },
}));

// Keep everything from drizzle-orm except eq, which botEngine calls with a
// mocked (column-less) table. A no-op eq avoids drizzle inspecting the column.
vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
}));

vi.mock("./broker", () => mocks.broker);
vi.mock("./brokerCredentialsService", () => mocks.credentials);
vi.mock("./planService", () => mocks.plan);
vi.mock("./notificationService", () => mocks.notify);
vi.mock("./engineLease", () => mocks.lease);
vi.mock("./maStrategy", () => mocks.ma);
vi.mock("./aiTrader", () => mocks.ai);
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { broker, ma } = mocks;

const defaultAccount: NormalizedAccount = {
  cash: 100_000,
  invested: 0,
  result: 0,
  total: 100_000,
  currency: "GBP",
};

/** A 30-point flat price series; long enough for the MA guard, currentPrice=100. */
const defaultPrices = Array<number>(30).fill(100);

/**
 * Existing tests encode short vs long via a negative quantity (a test-only
 * convenience — Capital.com's real `size` field is always a positive
 * magnitude, direction is a separate field) — default `direction` from the
 * quantity sign so every existing call site keeps working unchanged, while
 * new tests that care about direction can pass it explicitly.
 */
function position(
  ticker: string,
  quantity: number,
  direction: "BUY" | "SELL" = quantity >= 0 ? "BUY" : "SELL"
): NormalizedPosition {
  return {
    ticker,
    quantity,
    averagePrice: 100,
    currentPrice: 100,
    pnl: 0,
    pnlPercent: 0,
    direction,
    // Exit levels are display-only — the engine never reads them, so the
    // default of "none set" keeps every existing call site meaningful.
    stopLevel: null,
    takeProfitLevel: null,
    dealId: `deal-${ticker}`,
  };
}

/** The ISO week key the engine uses, so a test baseline lands in the current week. */
function utcWeekKeyOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * What the engine actually traded, from the trades it recorded: `{ticker, side,
 * quantity}` for every FILLED or DRY_RUN row, in order.
 *
 * Deliberately not read from a broker mock. Since 24 Sep 2026 an open and a
 * close take different broker calls — placeBrokerOrder opens, closeBrokerPosition
 * closes by deal id — and a test that asserts on placeBrokerOrder alone would
 * pass while the engine silently stopped closing anything.
 */
function traded(): Array<{ ticker: string; side: string; quantity: number }> {
  return mocks.tradeInserts
    .filter((r) => r["status"] === "FILLED" || r["status"] === "DRY_RUN")
    .map((r) => ({
      ticker: String(r["ticker"]),
      side: String(r["side"]),
      quantity: Number(r["quantity"]),
    }));
}

function account(total: number): NormalizedAccount {
  return { cash: total, invested: 0, result: 0, total, currency: "GBP" };
}

function buildConfig(patch: Partial<BotConfig> = {}): BotConfig {
  return {
    shortPeriod: 9,
    longPeriod: 21,
    tradeAmount: 50,
    intervalMinutes: 60,
    dryRun: true,
    broker: "capitalcom",
    stopLossPercent: 2,
    takeProfitPercent: 4,
    riskPerTradePercent: 1,
    maxPositionSizePercent: 5,
    maxDailyLossPercent: 3,
    maxConcurrentPositions: 5,
    aiTradeMode: "off",
    minAiConfidence: "any",
    strategyMode: "auto",
    minEdgeVsSpread: 3,
    maxTradesPerDay: 0,
    maxIntradayDrawdownPercent: 0,
    closeBeforeSessionEndMinutes: 0,
    noOpenAfterSessionStartMinutes: 0,
    activeProfileId: null,
    maxInstrumentExposurePercent: 0,
    maxTotalExposurePercent: 0,
    dailyProfitTarget: 0,
    equityFloor: 0,
    maxWeeklyLossPercent: 0,
    maxConsecutiveLosses: 0,
    reentryCooldownMinutes: 0,
    onePositionPerInstrument: false,
    maxNetDirectionalPercent: 0,
    regimeFilterEnabled: false,
    barResolution: "MINUTE_5",
    ...patch,
  };
}

/** Let all queued microtasks / floating promises (e.g. startBot's first cycle) settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

let engine: typeof import("./botEngine");

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.enabledInstruments = [];
  mocks.botConfigRows = [];
  mocks.recentTrades = [];
  mocks.equityBaselines = [];
  mocks.tradeInserts = [];
  mocks.signalInserts = [];
  mocks.runningWrites = [];
  // mockReset, not just clearAllMocks: clearing resets call history but leaves
  // any queued mockReturnValueOnce/mockResolvedValueOnce values in place. A
  // test that queues two and consumes one leaks the leftover into whatever runs
  // next, which showed up as an opening-window test passing alone and failing
  // in the suite — its BUY signal was a stale HOLD from an earlier test. Every
  // mock reset here is given its default again immediately below.
  broker.getBrokerAccount.mockReset();
  broker.getBrokerPositions.mockReset();
  broker.getBrokerPriceHistory.mockReset();
  broker.getBrokerQuote.mockReset();
  broker.placeBrokerOrder.mockReset();
  broker.getBrokerTransactions.mockReset();
  broker.closeBrokerPosition.mockReset();
  ma.computeMASignal.mockReset();
  mocks.credentials.getUserBrokerCredentials.mockReset();
  mocks.plan.getPlanLimits.mockReset();

  broker.getBrokerAccount.mockResolvedValue(defaultAccount);
  broker.getBrokerPositions.mockResolvedValue([]);
  broker.getBrokerPriceHistory.mockResolvedValue(defaultPrices);
  broker.getBrokerQuote.mockResolvedValue({
    ticker: "TEST",
    bid: 100,
    offer: 100,
    price: 100,
    marketStatus: "TRADEABLE",
    currency: "GBP",
    minDealSize: null,
    minStopDistancePercent: null,
  });
  broker.placeBrokerOrder.mockResolvedValue({ id: "order-1" });
  // No closed trades by default, so the losing-streak breaker never trips in
  // tests that are about something else.
  broker.getBrokerTransactions.mockResolvedValue([]);
  broker.closeBrokerPosition.mockResolvedValue(true);
  // Full entitlements by default so every pre-existing test — all written
  // before plans existed — keeps exercising the same paths unchanged. Tests
  // that care about the paywall override this explicitly.
  mocks.plan.getPlanLimits.mockResolvedValue({
    liveTrading: true,
    aiTradeModes: true,
    maxInstruments: Infinity,
    aiQueriesPerDay: Infinity,
  });
  mocks.lease.acquireLease.mockResolvedValue(true);
  mocks.lease.renewLease.mockResolvedValue(true);
  mocks.lease.holdsLease.mockResolvedValue(true);
  mocks.lease.releaseLease.mockResolvedValue(undefined);
  ma.computeMASignal.mockReturnValue({ signal: "HOLD", shortMa: 1, longMa: 1 });
  // Every test's user has a broker "connected" by default, matching the
  // pre-multi-tenant assumption that the single global account was always configured.
  mocks.credentials.getUserBrokerCredentials.mockResolvedValue({
    broker: "capitalcom",
    capital: { apiKey: "test-key", identifier: "test-id", password: "test-pw" },
  });

  // Fresh module = fresh in-memory bot state (running flag + circuit breaker).
  vi.resetModules();
  engine = await import("./botEngine");
});

afterEach(async () => {
  // Clear the interval startBot may have scheduled so timers don't leak.
  try {
    await engine.stopBot(TEST_USER_ID);
  } catch {
    /* ignore */
  }
});

/**
 * Puts the bot into a live-trading state (running + real orders) after
 * consuming the immediate first cycle that startBot fires. Instruments are left
 * empty for that first cycle so it places nothing; the caller then sets up
 * instruments/signals and calls runCycle() to make the assertions.
 */
async function startLiveBot(patch: Partial<BotConfig> = {}) {
  mocks.enabledInstruments = [];
  await engine.updateConfig(TEST_USER_ID, buildConfig({ dryRun: false, ...patch }));
  await engine.startBot(TEST_USER_ID);
  await flush();
}

describe("sizePosition — per-position size cap", () => {
  it("clamps to maxPositionSizePercent of balance", () => {
    // Base size (10% of 1000 = 100) exceeds the 5% cap (50) → clamp to 50.
    const cfg = buildConfig({ riskPerTradePercent: 10, maxPositionSizePercent: 5 });
    const { positionValue, quantity } = engine.sizePosition(10, cfg, 1000);
    expect(positionValue).toBe(50);
    expect(quantity).toBe(5);
  });

  it("does not clamp when the base size is under the cap", () => {
    const cfg = buildConfig({ riskPerTradePercent: 1, maxPositionSizePercent: 5 });
    const { positionValue } = engine.sizePosition(10, cfg, 1000);
    expect(positionValue).toBe(10); // 1% of 1000, under the 5% (50) cap
  });

  it("falls back to fixed tradeAmount (no cap) when balance is unknown", () => {
    const cfg = buildConfig({ riskPerTradePercent: 5, maxPositionSizePercent: 5, tradeAmount: 50 });
    const { positionValue, quantity } = engine.sizePosition(10, cfg, null);
    expect(positionValue).toBe(50);
    expect(quantity).toBe(5);
  });

  it("treats maxPositionSizePercent=0 as 'cap disabled'", () => {
    const cfg = buildConfig({ riskPerTradePercent: 50, maxPositionSizePercent: 0 });
    const { positionValue } = engine.sizePosition(10, cfg, 1000);
    expect(positionValue).toBe(500); // 50% of 1000, uncapped
  });
});

describe("fail-closed — risk data unavailable blocks new entries", () => {
  it("blocks a new BUY when the account fetch fails, but allows a SELL that closes an existing position", async () => {
    broker.getBrokerAccount.mockRejectedValue(new Error("broker down"));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 5)]);
    // Order matters: computeMASignal is called once per instrument in list order.
    ma.computeMASignal
      .mockReturnValueOnce({ signal: "BUY", shortMa: 2, longMa: 1 }) // NEWBUY (new ticker)
      .mockReturnValueOnce({ signal: "SELL", shortMa: 1, longMa: 2 }); // HELD (closing)

    await startLiveBot();
    mocks.enabledInstruments = [
      { ticker: "NEWBUY", enabled: true },
      { ticker: "HELD", enabled: true },
    ];
    const results = await engine.runCycle(TEST_USER_ID);

    // Only the closing SELL on the already-held ticker reaches the broker.
    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].ticker).toBe("HELD");
    expect(orders[0].side).toBe("SELL");

    expect(results.find((r) => r.ticker === "NEWBUY")?.tradeExecuted).toBe(false);
    expect(results.find((r) => r.ticker === "HELD")?.tradeExecuted).toBe(true);
  });

  it("blocks a BUY that ADDS to an already-held long when account data is unavailable (size cap can't be enforced)", async () => {
    // Regression: previously only NEW positions were blocked, so a BUY on a
    // held ticker slipped through and sizePosition fell back to a fixed amount,
    // bypassing maxPositionSizePercent. It must now be blocked as well.
    broker.getBrokerAccount.mockRejectedValue(new Error("broker down"));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 5)]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot();
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results.find((r) => r.ticker === "HELD")?.tradeExecuted).toBe(false);
  });

  it("blocks the autonomous-mode BUY on a held ticker when account data is unavailable", async () => {
    broker.getBrokerAccount.mockRejectedValue(new Error("broker down"));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 5)]);
    mocks.ai.decideTrades.mockResolvedValue([
      { ticker: "HELD", action: "BUY", confidence: 0.9, reason: "add to winner" },
    ]);

    await startLiveBot({ aiTradeMode: "autonomous" });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results.find((r) => r.ticker === "HELD")?.tradeExecuted).toBe(false);
  });

  it("also blocks a SELL that would open a NEW short when risk data is unavailable (a short is a new position)", async () => {
    broker.getBrokerAccount.mockRejectedValue(new Error("broker down"));
    broker.getBrokerPositions.mockResolvedValue([]); // nothing held → SELL opens a short
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot();
    mocks.enabledInstruments = [{ ticker: "NEWSHORT", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results.find((r) => r.ticker === "NEWSHORT")?.tradeExecuted).toBe(false);
  });
});

// Default config: riskPerTradePercent 1% of defaultAccount.total (100,000) =
// positionValue 1000, over defaultPrices' flat currentPrice of 100 = quantity 10.
describe("zero equity — the risk layer refuses on its own, without the AI", () => {
  it("blocks a new BUY when the account balance is zero", async () => {
    // Production evidence: with a £0 balance and aiTradeMode "guard", the ONLY
    // thing refusing orders was the model's prose veto ("The account has zero
    // funds available…"). aiTradeMode is a user setting — turn it off and that
    // veto disappears. The deterministic layer has to refuse this itself.
    //
    // Zero is not caught by the other gates: sizePosition returns a position
    // value of 0, and `quantity < (minDealSize ?? 0)` is `0 < 0` — false — so a
    // zero-quantity order would otherwise be sent for the broker to reject.
    broker.getBrokerAccount.mockResolvedValue(account(0));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ aiTradeMode: "off" });
    mocks.enabledInstruments = [{ ticker: "TEST", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results[0]?.tradeExecuted).toBe(false);
  });

  it("blocks on a negative balance too", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(-250));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ aiTradeMode: "off" });
    mocks.enabledInstruments = [{ ticker: "TEST", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("does not trap an open position: flatten-by-close still closes it in full", async () => {
    // The danger with any new block is trapping a position you cannot exit.
    // Flatten-by-close is the exit that matters, and it is unaffected: it sizes
    // from the POSITION (pos.quantity), not from equity, so a zero balance
    // cannot shrink it to nothing.
    broker.getBrokerAccount.mockResolvedValue(account(0));
    broker.getBrokerPositions.mockResolvedValue([position("CLOSEDMKT", 10)]);
    await startLiveBot({ aiTradeMode: "off" });

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "CLOSEDMKT",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "EDITS_ONLY",
      currency: "GBP",
      minDealSize: null,
      minStopDistancePercent: null,
    });
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].quantity).toBe(10); // the whole position, not an equity-derived size
    expect(orders[0].side).toBe("SELL");
  });

  it("closes a held position in full even at zero equity — sized from the position, not the balance", async () => {
    // Previously this SELL was sized from equity (0) and refused, so at zero
    // equity the strategy could never exit a position — only flatten-by-close
    // could. A close is now sized from what is held, and no exposure gate
    // (equity included) may block it.
    broker.getBrokerAccount.mockResolvedValue(account(0));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 5)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off" });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toEqual({ ticker: "HELD", side: "SELL", quantity: 5 }); // the whole holding
    // A close now goes through the broker's close-by-deal call, which takes no
    // stop-loss or take-profit at all — a close protects nothing, and after
    // 24 Sep 2026 it is not an order in the first place.
    expect(broker.closeBrokerPosition).toHaveBeenCalledWith(TEST_USER_ID, expect.anything(), "deal-HELD");
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("a funded account is unaffected", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ aiTradeMode: "off" });
    mocks.enabledInstruments = [{ ticker: "TEST", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(1);
  });
});

describe("minimum deal size — orders below the broker's minimum are skipped, not attempted", () => {
  it("skips a BUY (off mode) whose calculated quantity is below the broker's minimum deal size", async () => {
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });
    broker.getBrokerQuote.mockResolvedValue({
      ticker: "TINY",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "TRADEABLE",
      currency: "GBP",
      minDealSize: 20, // computed quantity (10) is below this
    });

    await startLiveBot();
    mocks.enabledInstruments = [{ ticker: "TINY", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results.find((r) => r.ticker === "TINY")?.tradeExecuted).toBe(false);
  });

  it("skips a BUY (autonomous mode) whose calculated quantity is below the broker's minimum deal size", async () => {
    broker.getBrokerPositions.mockResolvedValue([]);
    mocks.ai.decideTrades.mockResolvedValue([
      { ticker: "TINY", action: "BUY", confidence: 0.9, reason: "looks good" },
    ]);
    broker.getBrokerQuote.mockResolvedValue({
      ticker: "TINY",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "TRADEABLE",
      currency: "GBP",
      minDealSize: 20,
    });

    await startLiveBot({ aiTradeMode: "autonomous" });
    mocks.enabledInstruments = [{ ticker: "TINY", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results.find((r) => r.ticker === "TINY")?.tradeExecuted).toBe(false);
  });

  it("still places the order when the calculated quantity meets or exceeds the minimum", async () => {
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });
    broker.getBrokerQuote.mockResolvedValue({
      ticker: "OK",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "TRADEABLE",
      currency: "GBP",
      minDealSize: 5, // computed quantity (10) is at/above this
    });

    await startLiveBot();
    mocks.enabledInstruments = [{ ticker: "OK", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(1);
    expect(results.find((r) => r.ticker === "OK")?.tradeExecuted).toBe(true);
  });

  it("blocks a BUY that ADDS to an already-held position when the calculated quantity is below the minimum", async () => {
    // Regression: the min-size check is bundled with the market-status check
    // (checkEntryQuote), which used to be skipped entirely when adding to an
    // existing position (opensNewPosition === false) — it now always runs,
    // since a minimum-size order requirement applies to every new order, not
    // just ones opening a brand-new position.
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 5)]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });
    broker.getBrokerQuote.mockResolvedValue({
      ticker: "HELD",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "TRADEABLE",
      currency: "GBP",
      minDealSize: 20,
    });

    await startLiveBot();
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results.find((r) => r.ticker === "HELD")?.tradeExecuted).toBe(false);
  });

  it("never blocks a SELL that closes an existing position, regardless of the broker's minimum deal size", async () => {
    // Flatten-by-close (a full-quantity close) is a completely separate code
    // path from this entry-side gate and must never be affected by it.
    broker.getBrokerPositions.mockResolvedValue([position("CLOSEDMKT", 10)]);
    await startLiveBot();

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "CLOSEDMKT",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "EDITS_ONLY",
      currency: "GBP",
      minDealSize: 9999, // far above the held quantity (10) — must not block the close
    });
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
    const { ticker, quantity, side } = traded()[0]!;
    expect(ticker).toBe("CLOSEDMKT");
    expect(quantity).toBe(10);
    expect(side).toBe("SELL");
  });
});

describe("plan enforcement — the paywall is a server-side boundary", () => {
  const freePlan = {
    liveTrading: false,
    aiTradeModes: false,
    maxInstruments: 3,
    aiQueriesPerDay: 10,
  };

  it("never places a real order for a plan without live trading, even when the user has switched Dry Run OFF", async () => {
    // The security-critical case. `dryRun` is a user-editable setting, so a
    // free user can simply turn it off — the route that writes it also
    // rejects this, but THIS is the gate that actually guarantees no real
    // order reaches the broker.
    mocks.plan.getPlanLimits.mockResolvedValue(freePlan);
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ dryRun: false }); // explicitly opted into live trading
    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    // The signal is still produced and logged — the strategy runs normally,
    // it just simulates the fill. Free users still get a working dry-run bot.
    expect(results.find((r) => r.ticker === "AAA")?.signal).toBe("BUY");
  });

  it("still places real orders once the plan includes live trading", async () => {
    // Same setup as above with only the entitlement flipped, proving the
    // block above is caused by the plan and nothing else.
    mocks.plan.getPlanLimits.mockResolvedValue({ ...freePlan, liveTrading: true });
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ dryRun: false });
    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plain strategy when the plan excludes AI trade modes", async () => {
    // aiTradeMode 'autonomous' would normally hand the decision to decideTrades.
    mocks.plan.getPlanLimits.mockResolvedValue(freePlan);
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "HOLD", shortMa: 1, longMa: 1 });

    await startLiveBot({ aiTradeMode: "autonomous" });
    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(mocks.ai.decideTrades).not.toHaveBeenCalled();
  });

  it("simulates a manual trade for a plan without live trading", async () => {
    // The manual-trade panel is a third path to a real order, separate from
    // the bot cycle and the scanner — it needs the same gate.
    mocks.plan.getPlanLimits.mockResolvedValue(freePlan);
    await startLiveBot({ dryRun: false });

    await engine.executeManualTrade(TEST_USER_ID, { ticker: "AAA", side: "BUY", amount: 100 });

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });
});

describe("max concurrent positions — distinct open tickers", () => {
  it("counts a mixed long/short portfolio correctly and blocks only a brand-new ticker", async () => {
    // Two distinct positions (one long, one short) already fill a 2-slot limit.
    broker.getBrokerPositions.mockResolvedValue([
      position("AAA", 5), // long
      position("BBB", -3), // short
    ]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ maxConcurrentPositions: 2 });
    mocks.enabledInstruments = [
      { ticker: "CCC", enabled: true }, // brand-new ticker → should be blocked
      { ticker: "AAA", enabled: true }, // already held → adding does NOT need a new slot
    ];
    const results = await engine.runCycle(TEST_USER_ID);

    // Adding to the existing AAA is allowed; opening the new CCC is blocked.
    const orderedTickers = broker.placeBrokerOrder.mock.calls.map((c) => c[2]);
    expect(orderedTickers).toEqual(["AAA"]);
    expect(results.find((r) => r.ticker === "CCC")?.tradeExecuted).toBe(false);
    expect(results.find((r) => r.ticker === "AAA")?.tradeExecuted).toBe(true);
  });

  it("a repeated BUY on the same held ticker never consumes an extra slot even at the limit", async () => {
    broker.getBrokerPositions.mockResolvedValue([position("AAA", 5)]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ maxConcurrentPositions: 1 }); // already at the 1-slot limit
    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder.mock.calls.map((c) => c[2])).toEqual(["AAA"]);
    expect(results.find((r) => r.ticker === "AAA")?.tradeExecuted).toBe(true);
  });
});

describe("daily-loss circuit breaker", () => {
  it("captures the first equity of the UTC day as the loss baseline", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount.mockResolvedValue(account(1000));

    await startLiveBot({ maxDailyLossPercent: 3 });

    const status = await engine.getBotStatus(TEST_USER_ID);
    expect(status.circuitBreaker.dayStartEquity).toBe(1000);
    expect(status.circuitBreaker.tripped).toBe(false);
    expect(status.running).toBe(true);
  });

  it("does not trip on a loss below the limit", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000)) // baseline
      .mockResolvedValue(account(990)); // 1% loss < 3%

    await startLiveBot({ maxDailyLossPercent: 3 });
    await engine.runCycle(TEST_USER_ID);

    const status = await engine.getBotStatus(TEST_USER_ID);
    expect(status.circuitBreaker.tripped).toBe(false);
    expect(status.running).toBe(true);
  });

  it("trips and stops the bot when the daily loss reaches the limit", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000)) // baseline
      .mockResolvedValue(account(900)); // 10% loss ≥ 3%

    await startLiveBot({ maxDailyLossPercent: 3 });
    await engine.runCycle(TEST_USER_ID); // observes the loss → trips

    const status = await engine.getBotStatus(TEST_USER_ID);
    expect(status.circuitBreaker.tripped).toBe(true);
    expect(status.circuitBreaker.reason).toMatch(/limit/i);
    expect(status.running).toBe(false);

    // The user must HEAR about the halt — a stopped bot they believe is
    // running is the worst silent state this product has.
    expect(mocks.notify.notifyUser).toHaveBeenCalledWith(
      TEST_USER_ID,
      expect.objectContaining({ type: "circuit_breaker" }),
    );
  });

  it("stays halted across further cycles and is NOT cleared by starting the bot again", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000))
      .mockResolvedValue(account(900));

    await startLiveBot({ maxDailyLossPercent: 3 });
    await engine.runCycle(TEST_USER_ID); // trip

    // A tripped breaker skips the cycle entirely — no orders are placed.
    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });
    await engine.runCycle(TEST_USER_ID);
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();

    // Restarting the bot does not clear the breaker.
    await engine.startBot(TEST_USER_ID);
    await flush();
    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(true);
  });

  it("clears only via resumeBot, which resets the baseline and resumes trading", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000))
      .mockResolvedValue(account(900));

    await startLiveBot({ maxDailyLossPercent: 3 });
    await engine.runCycle(TEST_USER_ID); // trip
    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(true);

    await engine.resumeBot(TEST_USER_ID);
    await flush();

    const status = await engine.getBotStatus(TEST_USER_ID);
    expect(status.circuitBreaker.tripped).toBe(false);
    expect(status.running).toBe(true);
    // Baseline re-measured from the resume point (the 900 equity now in effect).
    expect(status.circuitBreaker.dayStartEquity).toBe(900);
  });
});

describe("one position per instrument", () => {
  it("refuses a BUY in an instrument already held long", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 5)]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ onePositionPerInstrument: true, maxConcurrentPositions: 0 });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("still allows the SELL that closes that position", async () => {
    // The whole point: a gate on NEW exposure must never trap an exit.
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 5)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ onePositionPerInstrument: true });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].side).toBe("SELL");
  });

  it("opens a position in an instrument that is not held", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 5)]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ onePositionPerInstrument: true });
    mocks.enabledInstruments = [{ ticker: "FRESH", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder.mock.calls).toHaveLength(1);
  });
});

describe("repeat guard — the same instruction is not sent twice", () => {
  /**
   * The 24 Sep 2026 duplicate: a second cycle 10 seconds after the first bought
   * GOLD and US500 again. The broker's position list had not caught up, so the
   * open-position check could not see the first fill — only our own order log
   * could, which is what the cooldown reads.
   */
  it("refuses a second entry seconds after the first, with the position not yet reported", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([]); // broker still shows nothing
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ reentryCooldownMinutes: 5, onePositionPerInstrument: true });
    mocks.enabledInstruments = [{ ticker: "GOLD", enabled: true }];
    mocks.recentTrades = [{ ticker: "GOLD", side: "BUY", executedAt: new Date(Date.now() - 10_000) }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("allows the entry once the cooldown has passed", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ reentryCooldownMinutes: 5 });
    mocks.enabledInstruments = [{ ticker: "GOLD", enabled: true }];
    mocks.recentTrades = [{ ticker: "GOLD", side: "BUY", executedAt: new Date(Date.now() - 6 * 60_000) }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder.mock.calls).toHaveLength(1);
  });

  it("never blocks a close, however recently the instrument traded", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("GOLD", 5)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ reentryCooldownMinutes: 60 });
    mocks.enabledInstruments = [{ ticker: "GOLD", enabled: true }];
    // A BUY moments ago must not hold back the SELL that exits it.
    mocks.recentTrades = [{ ticker: "GOLD", side: "BUY", executedAt: new Date() }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
  });

  it("does not hold back a different instrument", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ reentryCooldownMinutes: 5 });
    mocks.enabledInstruments = [{ ticker: "SILVER", enabled: true }];
    mocks.recentTrades = [{ ticker: "GOLD", side: "BUY", executedAt: new Date() }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder.mock.calls).toHaveLength(1);
  });
});

describe("exit distance below the broker's minimum", () => {
  /**
   * 24 Sep 2026: an ORCL buy was rejected with
   * `error.invalid.stoploss.maxvalue: 139.87` — the scalp profile asked for a
   * 0.3% stop on an instrument requiring about 0.57%. It then succeeded on the
   * retry a minute later at a slightly different price, so the rule was never
   * visible, just intermittently expensive in wasted orders.
   */
  const tightQuote = (minStopDistancePercent: number | null) => ({
    ticker: "ORCL",
    bid: 100,
    offer: 100,
    price: 100,
    marketStatus: "TRADEABLE",
    currency: "GBP",
    minDealSize: null,
    minStopDistancePercent,
    openingHours: null,
  });

  it("does not send an order the broker would reject", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([]);
    broker.getBrokerQuote.mockResolvedValue(tightQuote(0.57));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ stopLossPercent: 0.3, takeProfitPercent: 0.3 });
    mocks.enabledInstruments = [{ ticker: "ORCL", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(0);
  });

  it("sends it when the configured stop clears the minimum", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([]);
    broker.getBrokerQuote.mockResolvedValue(tightQuote(0.2));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ stopLossPercent: 0.3, takeProfitPercent: 0.3 });
    mocks.enabledInstruments = [{ ticker: "ORCL", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
  });

  it("fails open when the broker doesn't publish a minimum", async () => {
    // An unreadable rule must not stop trading — the broker rejecting one order
    // is a smaller cost than an instrument silently going dark.
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([]);
    broker.getBrokerQuote.mockResolvedValue(tightQuote(null));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ stopLossPercent: 0.3, takeProfitPercent: 0.3 });
    mocks.enabledInstruments = [{ ticker: "ORCL", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
  });

  it("never blocks a close, which carries no stop or take-profit at all", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([position("ORCL", 2)]);
    broker.getBrokerQuote.mockResolvedValue(tightQuote(0.57));
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ stopLossPercent: 0.3, takeProfitPercent: 0.3 });
    mocks.enabledInstruments = [{ ticker: "ORCL", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
    expect(traded()[0]!.side).toBe("SELL");
  });
});

describe("exitTooTightForBroker", () => {
  it("names the stop-loss when it is the one too close", () => {
    const r = engine.exitTooTightForBroker({ stopLossPercent: 0.3, takeProfitPercent: 3 }, 0.57);
    expect(r).toEqual({ which: "stop-loss", configured: 0.3, required: 0.57 });
  });

  it("catches a take-profit that is too close even when the stop is fine", () => {
    // One minimum applies to both levels, and either one rejects the order.
    const r = engine.exitTooTightForBroker({ stopLossPercent: 2, takeProfitPercent: 0.3 }, 0.57);
    expect(r?.which).toBe("take-profit");
  });

  it("passes when both clear the minimum", () => {
    expect(engine.exitTooTightForBroker({ stopLossPercent: 1, takeProfitPercent: 1 }, 0.57)).toBeNull();
  });

  it("ignores a level that is switched off", () => {
    expect(engine.exitTooTightForBroker({ stopLossPercent: 0, takeProfitPercent: 0 }, 0.57)).toBeNull();
  });

  it("passes when the minimum is unknown", () => {
    expect(engine.exitTooTightForBroker({ stopLossPercent: 0.01, takeProfitPercent: 0.01 }, null)).toBeNull();
  });
});

describe("net direction limit — correlated positions are one bet", () => {
  it("counts three shorts as one directional position, not three small ones", () => {
    const e = engine.exposureByTicker([
      position("GOLD", 2.5, "SELL"),
      position("US500", 2.5, "SELL"),
      position("US100", 2.5, "SELL"),
    ]);
    // Priced at 100 by the position() helper: £750 gross either way, but the
    // gross figure reads as three modest positions and the net as one bet.
    expect(e.total).toBe(750);
    expect(e.net).toBe(-750);
  });

  it("nets a long against a short", () => {
    const e = engine.exposureByTicker([position("GOLD", 3, "BUY"), position("US500", 2, "SELL")]);
    expect(e.total).toBe(500);
    expect(e.net).toBe(100);
  });

  it("refuses a fourth short once the cap is reached", async () => {
    // £5,000 account, 15% net cap = £750. Three £250 shorts are exactly at it.
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([
      position("GOLD", 2.5, "SELL"),
      position("US500", 2.5, "SELL"),
      position("US100", 2.5, "SELL"),
    ]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({
      maxNetDirectionalPercent: 15,
      maxConcurrentPositions: 0,
      riskPerTradePercent: 5,
      maxPositionSizePercent: 5,
    });
    mocks.enabledInstruments = [{ ticker: "SILVER", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(0);
  });

  it("still allows a BUY, which reduces the imbalance", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([
      position("GOLD", 2.5, "SELL"),
      position("US500", 2.5, "SELL"),
      position("US100", 2.5, "SELL"),
    ]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({
      maxNetDirectionalPercent: 15,
      maxConcurrentPositions: 0,
      riskPerTradePercent: 5,
      maxPositionSizePercent: 5,
    });
    mocks.enabledInstruments = [{ ticker: "SILVER", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
    expect(traded()[0]!.side).toBe("BUY");
  });

  it("cannot be walked past by several same-direction orders inside one cycle", async () => {
    // £5,000, 15% = £750, £250 each: three fit, the fourth and fifth must not.
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({
      maxNetDirectionalPercent: 15,
      maxConcurrentPositions: 0,
      riskPerTradePercent: 5,
      maxPositionSizePercent: 5,
    });
    mocks.enabledInstruments = [
      { ticker: "A", enabled: true },
      { ticker: "B", enabled: true },
      { ticker: "C", enabled: true },
      { ticker: "D", enabled: true },
      { ticker: "E", enabled: true },
    ];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(3);
  });

  it("is off at zero", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([
      position("GOLD", 2.5, "SELL"),
      position("US500", 2.5, "SELL"),
      position("US100", 2.5, "SELL"),
    ]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ maxNetDirectionalPercent: 0, maxConcurrentPositions: 0 });
    mocks.enabledInstruments = [{ ticker: "SILVER", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
  });

  it("never blocks a close, even from over the cap", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([
      position("GOLD", 10, "SELL"), // £1,000 short, already past a £750 cap
    ]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ maxNetDirectionalPercent: 15 });
    mocks.enabledInstruments = [{ ticker: "GOLD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
  });
});

describe("breachesNetDirectional", () => {
  it("allows an order that stays inside the cap", () => {
    expect(engine.breachesNetDirectional(-500, 200, false, 750)).toBe(false);
  });

  it("refuses one that pushes further past it", () => {
    expect(engine.breachesNetDirectional(-700, 200, false, 750)).toBe(true);
  });

  it("allows an order that reduces an imbalance already over the cap", () => {
    // Otherwise a breach locks the account out of the trades that would fix it
    // — the same mistake as a risk gate that blocks a close.
    expect(engine.breachesNetDirectional(-1000, 200, true, 750)).toBe(false);
  });

  it("measures the imbalance either way round", () => {
    expect(engine.breachesNetDirectional(700, 200, true, 750)).toBe(true);
  });

  it("is off with no cap", () => {
    expect(engine.breachesNetDirectional(-5000, 5000, false, Infinity)).toBe(false);
    expect(engine.breachesNetDirectional(-5000, 5000, false, 0)).toBe(false);
  });
});

describe("repeated closes — the runaway short", () => {
  /**
   * 24 Sep 2026, GOLD. Bought 0.1176 units, then SOLD 0.1 four times in six
   * minutes: every cycle read a long that was already closed and closed it
   * again. On a broker that opens a deal per order that is a 0.4-unit SHORT
   * nobody decided to hold, and no exposure cap could stop it — a close is
   * exempt from all of them, which is correct and is exactly why this guard
   * has to live somewhere else.
   */
  it("refuses a second SELL while the first has not been reported", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    // The broker still reports the long that the previous cycle already sold.
    broker.getBrokerPositions.mockResolvedValue([position("GOLD", 0.1)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ reentryCooldownMinutes: 5 });
    mocks.enabledInstruments = [{ ticker: "GOLD", enabled: true }];
    mocks.recentTrades = [{ ticker: "GOLD", side: "SELL", executedAt: new Date(Date.now() - 60_000) }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("allows the close once the broker has had time to report it", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([position("GOLD", 0.1)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ reentryCooldownMinutes: 5 });
    mocks.enabledInstruments = [{ ticker: "GOLD", enabled: true }];
    mocks.recentTrades = [{ ticker: "GOLD", side: "SELL", executedAt: new Date(Date.now() - 6 * 60_000) }];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
  });
});

describe("equity floor and the weekly loss limit", () => {
  it("halts at the equity floor even on a day that has lost nothing", async () => {
    // Every percentage limit here re-bases daily. Only the floor is absolute,
    // so this is the case no other limit catches: a flat day below the floor.
    broker.getBrokerAccount.mockResolvedValue(account(4400));

    await startLiveBot({ equityFloor: 4500, maxDailyLossPercent: 0, maxIntradayDrawdownPercent: 0 });
    await engine.runCycle(TEST_USER_ID);

    const status = await engine.getBotStatus(TEST_USER_ID);
    expect(status.circuitBreaker.tripped).toBe(true);
    expect(status.circuitBreaker.reason).toMatch(/floor/i);
    expect(status.running).toBe(false);
  });

  it("halts on the weekly loss when every daily limit is still satisfied", async () => {
    // Monday opened at 5000; today is a later day in the same week and equity
    // is 4740 — 5.2% down on the week, but flat today.
    mocks.equityBaselines = [
      {
        dayKey: null,
        dayStartEquity: null,
        dayPeakEquity: null,
        weekKey: utcWeekKeyOf(new Date()),
        weekStartEquity: 5000,
        profitLockedDayKey: null,
        lossStreakResetAt: null,
      },
    ];
    broker.getBrokerAccount.mockResolvedValue(account(4740));

    await startLiveBot({ maxWeeklyLossPercent: 5, maxDailyLossPercent: 3, maxIntradayDrawdownPercent: 2 });
    await engine.runCycle(TEST_USER_ID);

    const status = await engine.getBotStatus(TEST_USER_ID);
    expect(status.circuitBreaker.tripped).toBe(true);
    expect(status.circuitBreaker.reason).toMatch(/week/i);
  });

  it("keeps measuring the day from the PERSISTED baseline after a restart", async () => {
    // The hole this closes: a deploy used to re-open the day at whatever equity
    // the new process first saw, so an account already down could lose the full
    // daily limit a second time.
    const today = new Date().toISOString().slice(0, 10);
    mocks.equityBaselines = [
      {
        dayKey: today,
        dayStartEquity: 1000,
        dayPeakEquity: 1000,
        weekKey: utcWeekKeyOf(new Date()),
        weekStartEquity: 1000,
        profitLockedDayKey: null,
        lossStreakResetAt: null,
      },
    ];
    broker.getBrokerAccount.mockResolvedValue(account(960)); // 4% down on the day

    await startLiveBot({ maxDailyLossPercent: 3, maxIntradayDrawdownPercent: 0, maxWeeklyLossPercent: 0 });
    await engine.runCycle(TEST_USER_ID);

    const status = await engine.getBotStatus(TEST_USER_ID);
    expect(status.circuitBreaker.tripped).toBe(true);
    expect(status.circuitBreaker.dayStartEquity).toBe(1000);
  });

  it("a resume does NOT hand back a fresh weekly allowance", async () => {
    mocks.equityBaselines = [
      {
        dayKey: null,
        dayStartEquity: null,
        dayPeakEquity: null,
        weekKey: utcWeekKeyOf(new Date()),
        weekStartEquity: 5000,
        profitLockedDayKey: null,
        lossStreakResetAt: null,
      },
    ];
    broker.getBrokerAccount.mockResolvedValue(account(4740));

    await startLiveBot({ maxWeeklyLossPercent: 5, maxDailyLossPercent: 0, maxIntradayDrawdownPercent: 0 });
    await engine.runCycle(TEST_USER_ID);
    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(true);

    await engine.resumeBot(TEST_USER_ID);
    await flush();
    await engine.runCycle(TEST_USER_ID);

    // Still below the week's limit, so it halts again rather than granting
    // another 5% — a limit any click can clear bounds nothing.
    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(true);
  });
});

describe("losing-streak breaker", () => {
  /** A closed trade as Capital.com reports it: `size` is the realised result. */
  const close = (minutesAgo: number, size: string) => ({
    dateUtc: new Date(Date.now() - minutesAgo * 60_000).toISOString().slice(0, 19),
    instrumentName: "GOLD",
    transactionType: "TRADE",
    note: "Trade closed",
    size,
    currency: "GBP",
  });

  it("halts after the configured run of losing closes", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerTransactions.mockResolvedValue([
      close(50, "2.10"), // a win, further back
      close(40, "-0.80"),
      close(30, "-1.20"),
      close(20, "-0.40"),
    ]);

    await startLiveBot({ maxConsecutiveLosses: 3, maxDailyLossPercent: 0, maxIntradayDrawdownPercent: 0 });
    await engine.runCycle(TEST_USER_ID);

    const status = await engine.getBotStatus(TEST_USER_ID);
    expect(status.circuitBreaker.tripped).toBe(true);
    expect(status.circuitBreaker.reason).toMatch(/row/i);
    expect(status.running).toBe(false);
  });

  it("does not halt when the streak is broken by a win", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerTransactions.mockResolvedValue([
      close(40, "-0.80"),
      close(30, "-1.20"),
      close(20, "0.90"), // most recent close won
    ]);

    await startLiveBot({ maxConsecutiveLosses: 2, maxDailyLossPercent: 0, maxIntradayDrawdownPercent: 0 });
    await engine.runCycle(TEST_USER_ID);

    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(false);
  });

  it("a resume does not re-trip on the same losses", async () => {
    // Those closes stay in the broker's history for days. Without a reset mark
    // the bot would halt again on its very next cycle and could never restart.
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerTransactions.mockResolvedValue([
      close(40, "-0.80"),
      close(30, "-1.20"),
      close(20, "-0.40"),
    ]);

    await startLiveBot({ maxConsecutiveLosses: 3, maxDailyLossPercent: 0, maxIntradayDrawdownPercent: 0 });
    await engine.runCycle(TEST_USER_ID);
    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(true);

    await engine.resumeBot(TEST_USER_ID);
    await flush();
    await engine.runCycle(TEST_USER_ID);

    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(false);
  });

  it("does not halt on an unreadable history", async () => {
    // An unknown streak must never stop a bot: the equity limits still bound
    // the loss, and a halt here would be caused by the broker being slow.
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerTransactions.mockRejectedValue(new Error("broker down"));

    await startLiveBot({ maxConsecutiveLosses: 2, maxDailyLossPercent: 0, maxIntradayDrawdownPercent: 0 });
    await engine.runCycle(TEST_USER_ID);

    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(false);
  });
});

describe("settings changes do not fire an extra cycle", () => {
  it("re-arms on the existing cadence instead of trading immediately", async () => {
    // 24 Sep 2026: switching trading mode at 11:09:10 restarted the bot, which
    // cycled at once — 10 seconds after the 11:09:00 cycle — and bought GOLD
    // and US500 a second time.
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ intervalMinutes: 5 });
    mocks.enabledInstruments = [{ ticker: "GOLD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);
    expect(broker.placeBrokerOrder.mock.calls).toHaveLength(1);

    // A settings save moments later must not place a second order.
    await engine.updateConfig(TEST_USER_ID, { takeProfitPercent: 0.4 });
    await flush();
    expect(broker.placeBrokerOrder.mock.calls).toHaveLength(1);
  });
});

describe("flatten-by-close", () => {
  it("closes a held long position when its market is restricted but still orderable", async () => {
    // Positions are set up before startLiveBot(), but the default
    // getBrokerQuote mock (beforeEach) returns TRADEABLE, so startLiveBot's
    // own implicit first cycle does not flatten anything — only the
    // TRADEABLE→EDITS_ONLY override below, applied after, triggers the flatten
    // on the explicit runCycle() call. EDITS_ONLY is the state flatten-by-close
    // exists for: no new positions, but existing ones can still be closed.
    broker.getBrokerPositions.mockResolvedValue([position("CLOSEDMKT", 10)]); // long, direction BUY
    await startLiveBot();

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "CLOSEDMKT",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "EDITS_ONLY",
      currency: "GBP",
      minDealSize: null,
      minStopDistancePercent: null,
    });
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
    const { ticker, quantity, side } = traded()[0]!;
    expect(ticker).toBe("CLOSEDMKT");
    expect(quantity).toBe(10);
    expect(side).toBe("SELL"); // opposite of the long's BUY direction — a close, not a new short
    // A close carries no stop-loss or take-profit, and since 24 Sep 2026 it is
    // not an order at all: the deal is closed by its id, which is the only call
    // that removes a position rather than opening an offsetting one.
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(broker.closeBrokerPosition).toHaveBeenCalledWith(TEST_USER_ID, expect.anything(), "deal-CLOSEDMKT");
  });

  it("closes a held short position with a BUY (opposite of SELL)", async () => {
    broker.getBrokerPositions.mockResolvedValue([position("SHORTED", 4, "SELL")]);
    await startLiveBot();

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "SHORTED",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "EDITS_ONLY",
      currency: "GBP",
      minDealSize: null,
      minStopDistancePercent: null,
    });
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    const { ticker, quantity, side } = traded()[0]!;
    expect(ticker).toBe("SHORTED");
    expect(quantity).toBe(4);
    expect(side).toBe("BUY");
  });

  it("does NOT attempt a close when the market is fully CLOSED — the order would only be rejected", async () => {
    // The 25 Aug 2026 bug: "not TRADEABLE" was treated as "flatten now", so the
    // engine fired a close precisely when the broker could not accept one. It
    // produced seven consecutive rejected AMZN orders, one per hourly cycle
    // overnight, each answered "Rejected. AMZN is currently closed."
    broker.getBrokerPositions.mockResolvedValue([position("SHUTMKT", 10)]);
    await startLiveBot();

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "SHUTMKT",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "CLOSED",
      currency: "GBP",
      minDealSize: null,
      minStopDistancePercent: null,
    });
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("does not attempt a close for OFFLINE or SUSPENDED markets either", async () => {
    for (const marketStatus of ["OFFLINE", "SUSPENDED", "AUCTION_NO_EDIT"]) {
      broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
      broker.getBrokerPositions.mockResolvedValue([position("SHUTMKT", 10)]);
      broker.getBrokerQuote.mockResolvedValue({
        ticker: "SHUTMKT",
        bid: 100,
        offer: 100,
        price: 100,
        marketStatus,
        currency: "GBP",
        minDealSize: null,
      });
      mocks.enabledInstruments = [];
      await engine.runCycle(TEST_USER_ID);
      expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    }
  });

  it("never flattens a position whose market is still open (TRADEABLE)", async () => {
    broker.getBrokerPositions.mockResolvedValue([position("OPENMKT", 10)]);
    await startLiveBot();

    // getBrokerQuote still defaults to TRADEABLE (beforeEach) — no override.
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("fails CLOSED (leaves the position open) when the market-status lookup itself errors", async () => {
    // Opposite fail direction from checkEntryQuote: an unconfirmed
    // status must never force a close.
    broker.getBrokerPositions.mockResolvedValue([position("UNKNOWN", 10)]);
    await startLiveBot();

    broker.getBrokerQuote.mockRejectedValue(new Error("quote fetch failed"));
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("dry-run flatten never calls the broker, even when the market is restricted", async () => {
    broker.getBrokerPositions.mockResolvedValue([position("CLOSEDMKT", 10)]);
    await startLiveBot({ dryRun: true }); // runCycle's dryRun is true regardless (cfg.dryRun || !running)

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "CLOSEDMKT",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "EDITS_ONLY",
      currency: "GBP",
      minDealSize: null,
      minStopDistancePercent: null,
    });
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("retries a failed close on the next cycle", async () => {
    broker.getBrokerPositions.mockResolvedValue([position("CLOSEDMKT", 10)]);
    await startLiveBot();

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "CLOSEDMKT",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "EDITS_ONLY",
      currency: "GBP",
      minDealSize: null,
      minStopDistancePercent: null,
    });
    mocks.enabledInstruments = [];

    broker.placeBrokerOrder.mockRejectedValueOnce(new Error("broker rejected the close"));
    await engine.runCycle(TEST_USER_ID);
    expect(traded()).toHaveLength(1);

    // Position is still reported open by the broker (mock unchanged) — the
    // next cycle attempts the close again, same retry behavior as any other
    // trade failure.
    broker.placeBrokerOrder.mockResolvedValueOnce({ id: "order-2" });
    await engine.runCycle(TEST_USER_ID);
    expect(traded()).toHaveLength(2);
  });
});

/** A bot_config row as the database would return it, defaulting to running. */
function buildConfigRow(userId: number, patch: Partial<BotConfig> & { running?: boolean } = {}) {
  const { running = true, ...configPatch } = patch;
  return {
    id: userId,
    userId,
    running,
    costPerTradePercent: 0,
    updatedAt: new Date(),
    ...buildConfig(configPatch),
  };
}

describe("running state is persisted so a restart can restore it", () => {
  it("records the intent on start and on stop", async () => {
    await engine.startBot(TEST_USER_ID);
    await flush();
    expect(mocks.runningWrites).toContain(true);

    mocks.runningWrites = [];
    await engine.stopBot(TEST_USER_ID);
    expect(mocks.runningWrites).toEqual([false]);
  });

  it("persists STOPPED when the daily-loss circuit breaker trips", async () => {
    // The breaker must never auto-resume. Since the breaker itself is in-memory
    // and resets on restart, `running: false` in the database is the only thing
    // stopping a restart from resurrecting a bot that blew its daily loss limit.
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000)) // baseline
      .mockResolvedValue(account(900)); // 10% loss ≥ 3% limit

    await startLiveBot({ maxDailyLossPercent: 3 });
    mocks.runningWrites = [];
    await engine.runCycle(TEST_USER_ID); // observes the loss → trips → stops

    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(true);
    expect(mocks.runningWrites).toContain(false);
  });

  it("clears the flag even with no in-memory state, so an admin can stop a bot from a previous process", async () => {
    await engine.stopBot(4242);
    expect(mocks.runningWrites).toEqual([false]);
  });
});

const closedQuote = {
  ticker: "HELD",
  bid: 100,
  offer: 100,
  price: 100,
  marketStatus: "CLOSED",
  currency: "GBP",
  minDealSize: null,
};

describe("closing orders — sized from the position, never from the balance", () => {
  it("closes exactly the held quantity, however large the risk setting has become", async () => {
    // The case that makes raising Risk Per Trade dangerous: a 0.2-unit (£20)
    // long, closed after risk was raised to 50% of a £1,000 account. Sized from
    // the balance, that "close" is a £500 sell — 5 units — and 4.8 of them
    // become a short nobody asked for.
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 0.2)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off", riskPerTradePercent: 50, maxPositionSizePercent: 50 });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].quantity).toBe(0.2);
    expect(orders[0].side).toBe("SELL");
  });

  it("sums every deal on the ticker — the broker returns one row per deal", async () => {
    // Buying PL twice (17 and 18 Sep) left two positions, not one. A close that
    // took only the first would leave the second open.
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 1.165), position("HELD", 1.228)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off" });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    // Each deal is closed by its own id, so two deals are two closes. What
    // matters is that nothing is left behind: the closed sizes sum to the
    // whole holding, and both deals were named.
    const closed = traded();
    expect(closed).toHaveLength(2);
    expect(closed.reduce((t, c) => t + c.quantity, 0)).toBeCloseTo(2.393, 9);
    expect(broker.closeBrokerPosition).toHaveBeenCalledTimes(2);
  });

  it("does the same in autonomous mode", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 0.2)]);
    mocks.ai.decideTrades.mockResolvedValue([
      { ticker: "HELD", action: "SELL", confidence: "high", reason: "cut the loss" },
    ]);

    await startLiveBot({ aiTradeMode: "autonomous", riskPerTradePercent: 50, maxPositionSizePercent: 50 });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].quantity).toBe(0.2);
  });

  it("a BUY on a held SHORT is a close, and no exposure gate may block it", async () => {
    // Previously `isBuy` alone counted as exposure-increasing, so buying back a
    // short was refused whenever the balance couldn't be read — trapping it.
    broker.getBrokerAccount.mockRejectedValue(new Error("broker down"));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 3, "SELL")]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ aiTradeMode: "off" });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].quantity).toBe(3);
    expect(orders[0].side).toBe("BUY");
  });

  it("a SELL adding to a held short increases exposure, so the gates DO apply", async () => {
    // The mirror of the case above. `(opensNewPosition || isBuy)` let this
    // straight through when risk data was missing.
    broker.getBrokerAccount.mockRejectedValue(new Error("broker down"));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 3, "SELL")]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off" });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("a close is allowed at the daily trade cap; a new position is not", async () => {
    // A cap on churn must never trap a position. The cap counts one trade
    // today, the limit is one: the close goes through, the new entry does not.
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 5)]);
    ma.computeMASignal
      .mockReturnValueOnce({ signal: "SELL", shortMa: 1, longMa: 2 }) // HELD → close
      .mockReturnValueOnce({ signal: "BUY", shortMa: 2, longMa: 1 }); // NEW → open

    await startLiveBot({ aiTradeMode: "off", maxTradesPerDay: 1 });
    // Two orders already executed today, past a cap of one.
    mocks.recentTrades = [
      { ticker: "HELD", side: "SELL", executedAt: new Date() },
      { ticker: "NEW", side: "BUY", executedAt: new Date() },
    ];
    mocks.enabledInstruments = [
      { ticker: "HELD", enabled: true },
      { ticker: "NEW", enabled: true },
    ];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].ticker).toBe("HELD");
    expect(orders[0].side).toBe("SELL");
  });
});

describe("closed markets — no order is sent that the broker must reject", () => {
  it("defers a close while the market is closed, and records no failed trade", async () => {
    // Production, 17-18 Sep: 32 SELLs of PL rejected with "PL is currently
    // closed", one every few minutes from 20:32 until the 13:30 open.
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 1.165)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off" });
    broker.getBrokerQuote.mockResolvedValue(closedQuote);
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results[0]?.tradeExecuted).toBe(false);
  });

  it("defers the autonomous-mode close too — the path that actually stormed", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 1.165)]);
    mocks.ai.decideTrades.mockResolvedValue([
      { ticker: "HELD", action: "SELL", confidence: "high", reason: "cut the loss" },
    ]);

    await startLiveBot({ aiTradeMode: "autonomous" });
    broker.getBrokerQuote.mockResolvedValue(closedQuote);
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("does not block a close when the market allows closing but not opening", async () => {
    // EDITS_ONLY: new positions refused, existing ones may be closed. Blocking
    // this would trap positions in exactly the state flatten-by-close exists for.
    broker.getBrokerAccount.mockResolvedValue(account(1000));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 2)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off" });
    // Flatten-by-close would also close this on EDITS_ONLY; either path is
    // fine, as long as the position is closed once and in full.
    broker.getBrokerQuote.mockResolvedValue({ ...closedQuote, marketStatus: "EDITS_ONLY" });
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].quantity).toBe(2);
    expect(orders[0].side).toBe("SELL");
  });
});

describe("planOrder / heldByTicker", () => {
  const cfg = () => ({ riskPerTradePercent: 1, maxPositionSizePercent: 10, tradeAmount: 20 }) as never;

  it("opens are sized from the balance", () => {
    const plan = engine.planOrder("BUY", "X", new Map(), 100, cfg(), 2000);
    expect(plan).toEqual({ closing: false, quantity: 0.2, positionValue: 20 });
  });

  it("adding in the same direction is an open, not a close", () => {
    const held = engine.heldByTicker([position("X", 3)]);
    expect(engine.planOrder("BUY", "X", held, 100, cfg(), 2000).closing).toBe(false);
  });

  it("the opposite side is a close of exactly what is held", () => {
    const held = engine.heldByTicker([position("X", 3), position("X", 1.5), position("Y", 9)]);
    expect(engine.planOrder("SELL", "X", held, 100, cfg(), 2000)).toEqual({
      closing: true,
      quantity: 4.5,
      positionValue: 450,
    });
  });
});

/** A US stock CFD's schedule, as Capital.com publishes it. */
const usStockHours = {
  mon: ["13:30 - 20:00"],
  tue: ["13:30 - 20:00"],
  wed: ["13:30 - 20:00"],
  thu: ["13:30 - 20:00"],
  fri: ["13:30 - 20:00"],
  sat: [],
  sun: [],
  zone: "UTC",
};

function openQuote(ticker: string, openingHours: unknown = usStockHours) {
  return { ticker, bid: 100, offer: 100, price: 100, marketStatus: "TRADEABLE", currency: "GBP", minDealSize: null, openingHours };
}

describe("the opening window — no new positions while the averages are yesterday's", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(isoUtc: string) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${isoUtc}Z`));
  }

  it("refuses a new position minutes after the open", async () => {
    // Monday 13:36 UTC, six minutes into a 13:30 open — the exact moment the
    // AI guard was refusing every signal on 24 Sep 2026.
    at("2026-09-21T13:36:00");
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("PL"));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ noOpenAfterSessionStartMinutes: 30 });
    mocks.enabledInstruments = [{ ticker: "PL", enabled: true }];
    mocks.tradeInserts = [];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(0);
  });

  it("allows one once the window has passed", async () => {
    at("2026-09-21T14:05:00"); // 35 minutes in
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("PL"));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ noOpenAfterSessionStartMinutes: 30 });
    mocks.enabledInstruments = [{ ticker: "PL", enabled: true }];
    mocks.tradeInserts = [];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
  });

  it("never blocks a CLOSE inside the window", async () => {
    // A gate on new exposure must not trap an exit, however volatile the open.
    at("2026-09-21T13:36:00");
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([position("PL", 3)]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("PL"));
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ noOpenAfterSessionStartMinutes: 30 });
    mocks.enabledInstruments = [{ ticker: "PL", enabled: true }];
    mocks.tradeInserts = [];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
    expect(traded()[0]!.side).toBe("SELL");
  });

  it("is off at zero", async () => {
    at("2026-09-21T13:31:00");
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("PL"));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ noOpenAfterSessionStartMinutes: 0 });
    mocks.enabledInstruments = [{ ticker: "PL", enabled: true }];
    mocks.tradeInserts = [];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
  });

  it("does not hold back a market with no readable open", async () => {
    // Unknown must never block: an unreadable schedule taking an instrument
    // dark all day is a worse failure than one trade at a bad moment.
    at("2026-09-21T13:36:00");
    broker.getBrokerAccount.mockResolvedValue(account(5000));
    broker.getBrokerPositions.mockResolvedValue([]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("PL", null));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ noOpenAfterSessionStartMinutes: 30 });
    mocks.enabledInstruments = [{ ticker: "PL", enabled: true }];
    mocks.tradeInserts = [];
    await engine.runCycle(TEST_USER_ID);

    expect(traded()).toHaveLength(1);
  });
});

describe("close before the session ends", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Pin the clock. Only Date is faked, so the suite's setTimeout-based flush still runs. */
  function at(isoUtc: string) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${isoUtc}Z`));
  }

  it("closes a held stock position in full inside the window", async () => {
    // Monday 19:52 UTC: 8 minutes before a 20:00 close, inside a 10-minute window.
    at("2026-09-21T19:52:00");
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerPositions.mockResolvedValue([position("PL", 1.165)]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("PL"));

    await startLiveBot({ closeBeforeSessionEndMinutes: 10 });
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    // The whole deal, closed by its id, never equity-sized and never an
    // opposite order that would leave the original open.
    expect(traded()).toEqual([{ ticker: "PL", side: "SELL", quantity: 1.165 }]);
    expect(broker.closeBrokerPosition).toHaveBeenCalledWith(TEST_USER_ID, expect.anything(), "deal-PL");
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("leaves it alone outside the window", async () => {
    at("2026-09-21T18:00:00"); // two hours to go
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerPositions.mockResolvedValue([position("PL", 1.165)]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("PL"));

    await startLiveBot({ closeBeforeSessionEndMinutes: 10 });
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("does nothing when switched off, even at 19:59", async () => {
    at("2026-09-21T19:59:00");
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerPositions.mockResolvedValue([position("PL", 1.165)]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("PL"));

    await startLiveBot({ closeBeforeSessionEndMinutes: 0 });
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("does not close when the schedule cannot be read", async () => {
    // Unknown hours must never read as "closing now".
    at("2026-09-21T19:55:00");
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerPositions.mockResolvedValue([position("PL", 1.165)]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("PL", { ...usStockHours, zone: "America/New_York" }));

    await startLiveBot({ closeBeforeSessionEndMinutes: 10 });
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("does not close for an index's short nightly pause", async () => {
    at("2026-09-21T21:55:00"); // 5 minutes before a 65-minute break
    const indexHours = {
      mon: ["00:00 - 22:00", "23:05 - 00:00"],
      tue: ["00:00 - 22:00", "23:05 - 00:00"],
      wed: ["00:00 - 22:00", "23:05 - 00:00"],
      thu: ["00:00 - 22:00", "23:05 - 00:00"],
      fri: ["00:00 - 22:00"],
      sat: [],
      sun: ["23:05 - 00:00"],
      zone: "UTC",
    };
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerPositions.mockResolvedValue([position("US500", 2)]);
    broker.getBrokerQuote.mockResolvedValue(openQuote("US500", indexHours));

    await startLiveBot({ closeBeforeSessionEndMinutes: 10 });
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("opens nothing within the window plus one cycle, and opens normally before it", async () => {
    // 10-minute close window + 5-minute cycle = no new positions in the last 15.
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerQuote.mockResolvedValue(openQuote("NEW"));
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    at("2026-09-21T19:48:00"); // 12 minutes to go
    await startLiveBot({ aiTradeMode: "off", closeBeforeSessionEndMinutes: 10, intervalMinutes: 5 });
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    mocks.enabledInstruments = [{ ticker: "NEW", enabled: true }];
    await engine.runCycle(TEST_USER_ID);
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-09-21T19:40:00Z")); // 20 minutes to go
    await engine.runCycle(TEST_USER_ID);
    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(1);
  });
});

describe("daily profit lock", () => {
  it("stops new positions once equity is up by the target, and says so once", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(2000)) // the day's baseline, set on the first cycle
      .mockResolvedValue(account(2045)); // +£45, past a £40 target
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ aiTradeMode: "off", dailyProfitTarget: 40 });
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    mocks.notify.notifyUser.mockClear();
    mocks.enabledInstruments = [{ ticker: "NEW", enabled: true }];

    await engine.runCycle(TEST_USER_ID);
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    const profitNotices = mocks.notify.notifyUser.mock.calls.filter((c) => c[1]?.type === "profit_target");
    expect(profitNotices).toHaveLength(1); // once, not every cycle
  });

  it("stays locked when equity dips back under the target — re-entering is how gains are given back", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(2000)) // baseline
      .mockResolvedValueOnce(account(2045)) // locks
      .mockResolvedValue(account(2010)); // dips to +£10
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ aiTradeMode: "off", dailyProfitTarget: 40 });
    mocks.enabledInstruments = [{ ticker: "NEW", enabled: true }];
    await engine.runCycle(TEST_USER_ID); // locks
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    await engine.runCycle(TEST_USER_ID); // dipped — still locked

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("still lets a position be closed while locked", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(2000))
      .mockResolvedValue(account(2045));
    broker.getBrokerPositions.mockResolvedValue([position("HELD", 3)]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off", dailyProfitTarget: 40 });
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    mocks.enabledInstruments = [{ ticker: "HELD", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].side).toBe("SELL");
    expect(orders[0].quantity).toBe(3);
  });

  it("does not lock below the target", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(2000))
      .mockResolvedValue(account(2030)); // +£30 against £40
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ aiTradeMode: "off", dailyProfitTarget: 40 });
    broker.placeBrokerOrder.mockClear();
    broker.closeBrokerPosition.mockClear();
    // traded() reads the recorded trades, so the setup cycle's rows must go too.
    mocks.tradeInserts = [];
    mocks.enabledInstruments = [{ ticker: "NEW", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(1);
  });
});

describe("exposure caps — the SMCI accumulation", () => {
  it("blocks the order that would take one instrument past its cap, however small the order", async () => {
    // 22-23 Sep: 108 sells of ~0.36 units each built a 39-unit SMCI short worth
    // ~80% of the account. Every order passed every limit: the concurrent-position
    // cap counts distinct instruments, and the size cap applies per order.
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    // £480 of SMCI already held, short. A 25% cap on £2,000 is £500.
    broker.getBrokerPositions.mockResolvedValue([position("SMCI", 12, "SELL")]); // 12 × 40 = £480
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off", maxInstrumentExposurePercent: 25, riskPerTradePercent: 5 });
    mocks.enabledInstruments = [{ ticker: "SMCI", enabled: true }];
    const results = await engine.runCycle(TEST_USER_ID);

    // £480 + £100 would be £580, past the £500 limit.
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results[0]?.tradeExecuted).toBe(false);
  });

  it("counts a short exactly like a long — exposure is what you'd lose being wrong", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerPositions.mockResolvedValue([position("SMCI", 12, "SELL")]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    // A BUY here CLOSES the short, so it must still be allowed.
    await startLiveBot({ aiTradeMode: "off", maxInstrumentExposurePercent: 25, riskPerTradePercent: 5 });
    mocks.enabledInstruments = [{ ticker: "SMCI", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    const orders = traded();
    expect(orders).toHaveLength(1);
    expect(orders[0].quantity).toBe(12); // the whole short, closed
  });

  it("sums every deal on the ticker, not just the biggest", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    // Three separate deals — how Capital.com actually reports them.
    broker.getBrokerPositions.mockResolvedValue([
      position("SMCI", 4, "SELL"),
      position("SMCI", 4, "SELL"),
      position("SMCI", 4, "SELL"),
    ]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off", maxInstrumentExposurePercent: 25, riskPerTradePercent: 5 });
    mocks.enabledInstruments = [{ ticker: "SMCI", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("cannot be walked past by several orders inside one cycle", async () => {
    // Nothing held, £2,000 account, 25% cap = £500, each order £200.
    // Two fit; the third must not.
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerPositions.mockResolvedValue([]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({
      aiTradeMode: "off",
      maxTotalExposurePercent: 25,
      riskPerTradePercent: 10,
      maxPositionSizePercent: 10, // or the default 5% cap would size each order at £100
      maxConcurrentPositions: 0,
    });
    mocks.enabledInstruments = [
      { ticker: "AAA", enabled: true },
      { ticker: "BBB", enabled: true },
      { ticker: "CCC", enabled: true },
    ];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(2);
  });

  it("blocks new exposure when the position list is unavailable — an unmeasurable cap is no cap", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerPositions.mockRejectedValue(new Error("broker down"));
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off", maxInstrumentExposurePercent: 25, maxConcurrentPositions: 0 });
    mocks.enabledInstruments = [{ ticker: "SMCI", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("is off at 0, so nothing changes for anyone who hasn't set it", async () => {
    broker.getBrokerAccount.mockResolvedValue(account(2000));
    broker.getBrokerPositions.mockResolvedValue([position("SMCI", 40, "SELL")]);
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot({ aiTradeMode: "off", maxInstrumentExposurePercent: 0, maxTotalExposurePercent: 0 });
    mocks.enabledInstruments = [{ ticker: "SMCI", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(1);
  });
});

describe("exposureByTicker", () => {
  it("sums both directions as absolute notional", () => {
    const e = engine.exposureByTicker([
      position("SMCI", 12, "SELL"),
      position("SMCI", 3, "BUY"),
      position("GOLD", 2, "BUY"),
    ]);
    expect(e.byTicker.get("SMCI")).toBe(1500); // (12 + 3) × 100
    expect(e.byTicker.get("GOLD")).toBe(200);
    expect(e.total).toBe(1700);
  });
});

describe("concurrent starts — one bot, one timer", () => {
  afterEach(async () => {
    await engine.stopBot(TEST_USER_ID);
  });

  it("runs one cycle, not two, when two starts race", async () => {
    // The real-world shape: two Start clicks landing while the first request is
    // still awaiting the broker-credential lookup. Before the `starting` claim
    // both got past the `running` check (only set after that await) and each
    // armed an interval AND fired an immediate cycle. stopBot can clear only one
    // handle, so the loser cycled on invisibly — and with dry run off that is a
    // duplicate order every interval, forever.
    mocks.enabledInstruments = [{ ticker: "TEST", enabled: true }];
    broker.getBrokerPriceHistory.mockClear();

    await Promise.all([engine.startBot(TEST_USER_ID), engine.startBot(TEST_USER_ID)]);
    await flush();

    // One instrument, one cycle → exactly one history fetch. Two before the fix.
    expect(broker.getBrokerPriceHistory).toHaveBeenCalledTimes(1);
  });

  it("stays startable after a failed start", async () => {
    // The claim must be released on the error path too, or a single failed
    // start would wedge the bot as unstartable until the process restarted.
    mocks.credentials.getUserBrokerCredentials.mockResolvedValueOnce(null);
    await expect(engine.startBot(TEST_USER_ID)).rejects.toBeInstanceOf(engine.BrokerNotConnectedError);

    await engine.startBot(TEST_USER_ID);
    await flush();
    expect((await engine.getBotStatus(TEST_USER_ID)).running).toBe(true);
  });
});

describe("ownership lease — two processes never run one bot", () => {
  afterEach(async () => {
    await engine.stopBot(TEST_USER_ID);
  });

  it("refuses to start a bot another process owns", async () => {
    // The deploy case: the incoming instance boots while the outgoing one still
    // holds the lease. Starting here would put two engines on one account.
    mocks.lease.acquireLease.mockResolvedValue(false);

    await expect(engine.startBot(TEST_USER_ID)).rejects.toBeInstanceOf(engine.EngineOwnedElsewhereError);
    expect((await engine.getBotStatus(TEST_USER_ID)).running).toBe(false);
  });

  it("does not clear the user's running intent when the bot is owned elsewhere", async () => {
    // Critical: a refused start must not look like "the user stopped it".
    // Clearing the column would stop the bot in the process that IS running it.
    mocks.lease.acquireLease.mockResolvedValue(false);
    mocks.runningWrites = [];

    await expect(engine.startBot(TEST_USER_ID)).rejects.toBeInstanceOf(engine.EngineOwnedElsewhereError);

    expect(mocks.runningWrites).not.toContain(false);
  });

  it("aborts a cycle and places nothing if the lease was lost mid-run", async () => {
    // The window this closes: a process that has lost its lease still believes
    // it is running until its next renewal. Every cycle re-checks against the
    // database before anything can be ordered.
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });
    await startLiveBot();
    mocks.enabledInstruments = [{ ticker: "TEST", enabled: true }];

    mocks.lease.holdsLease.mockResolvedValue(false);
    const results = await engine.runCycle(TEST_USER_ID);

    expect(results).toEqual([]);
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("stands down without clearing running intent when the lease is lost", async () => {
    // Standing down is local. The new owner is running this bot, so the column
    // must keep saying "running" — it records the USER's intent, not which
    // process happens to hold it.
    await startLiveBot();
    mocks.enabledInstruments = [{ ticker: "TEST", enabled: true }];
    mocks.runningWrites = [];

    mocks.lease.holdsLease.mockResolvedValue(false);
    await engine.runCycle(TEST_USER_ID);

    expect((await engine.getBotStatus(TEST_USER_ID)).running).toBe(false); // stopped HERE
    expect(mocks.runningWrites).not.toContain(false); // but not stopped everywhere
  });

  it("releases the lease on a real stop, so a successor can take over at once", async () => {
    await startLiveBot();
    mocks.lease.releaseLease.mockClear();

    await engine.stopBot(TEST_USER_ID);

    expect(mocks.lease.releaseLease).toHaveBeenCalledWith(TEST_USER_ID, "bot");
    expect(mocks.runningWrites).toContain(false); // a real stop DOES clear intent
  });

  it("does not release the lease when standing down — it belongs to the new owner", async () => {
    // Releasing here would delete the successor's row, freeing a lease that is
    // legitimately held and letting a third process start the same bot.
    await startLiveBot();
    mocks.enabledInstruments = [{ ticker: "TEST", enabled: true }];
    mocks.lease.releaseLease.mockClear();

    mocks.lease.holdsLease.mockResolvedValue(false);
    await engine.runCycle(TEST_USER_ID);

    expect(mocks.lease.releaseLease).not.toHaveBeenCalled();
  });

  it("a manual cycle on a stopped bot needs no lease and still cannot trade", async () => {
    // Not-running cycles are forced to dry run, so they place nothing and have
    // no reason to demand ownership.
    mocks.lease.holdsLease.mockResolvedValue(false);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });
    mocks.enabledInstruments = [{ ticker: "TEST", enabled: true }];

    const results = await engine.runCycle(TEST_USER_ID);

    expect(results).toHaveLength(1); // the cycle ran
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled(); // but placed nothing
  });
});

describe("resumeRunningBots — bots survive a restart", () => {
  const RESUMED_USER = 7;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await engine.stopBot(RESUMED_USER);
    await engine.stopBot(8);
    vi.useRealTimers();
  });

  it("re-arms a bot whose saved state says running", async () => {
    mocks.botConfigRows = [buildConfigRow(RESUMED_USER)];

    const { resumed, skipped } = await engine.resumeRunningBots();

    expect(resumed).toBe(1);
    expect(skipped).toBe(0);
    expect(engine.peekBotRunning(RESUMED_USER)).toBe(true);
  });

  it("reports nothing to do when no bot was running", async () => {
    mocks.botConfigRows = [];
    expect(await engine.resumeRunningBots()).toEqual({ resumed: 0, skipped: 0 });
  });

  it("does not trade the instant it resumes, but does once the stagger elapses", async () => {
    // Firing every restored bot's cycle at once would burst the broker API for
    // exactly the users being restored, so the first cycle is held back.
    mocks.botConfigRows = [buildConfigRow(RESUMED_USER)];
    await engine.resumeRunningBots();

    expect(broker.getBrokerAccount).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(broker.getBrokerAccount).toHaveBeenCalledTimes(1);
  });

  it("spaces multiple bots out instead of starting them together", async () => {
    mocks.botConfigRows = [buildConfigRow(RESUMED_USER), buildConfigRow(8)];
    await engine.resumeRunningBots();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(broker.getBrokerAccount).toHaveBeenCalledTimes(1); // only the first

    await vi.advanceTimersByTimeAsync(20_000);
    expect(broker.getBrokerAccount).toHaveBeenCalledTimes(2); // now the second
  });

  it("leaves a bot stopped when its broker is no longer connected, and clears the saved flag", async () => {
    // The user disconnected their broker while this process was down. Claiming
    // RUNNING for a bot that cannot place a single order would be a lie.
    mocks.credentials.getUserBrokerCredentials.mockResolvedValue(null);
    mocks.botConfigRows = [buildConfigRow(RESUMED_USER)];

    const { resumed, skipped } = await engine.resumeRunningBots();

    expect(resumed).toBe(0);
    expect(skipped).toBe(1);
    expect(engine.peekBotRunning(RESUMED_USER)).toBe(false);
    expect(mocks.runningWrites).toContain(false);
  });

  it("never claims a bot is running just because the database says it was", async () => {
    // Only resumeRunningBots may flip the in-memory flag, because it is the only
    // path that also arms the timers. If a plain status read trusted the column,
    // the UI would show RUNNING with nothing actually scheduled — the precise
    // failure this column was added to prevent.
    mocks.botConfigRows = [buildConfigRow(RESUMED_USER)];

    expect((await engine.getBotStatus(RESUMED_USER)).running).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(broker.getBrokerAccount).not.toHaveBeenCalled();
  });

  it("cancels the pending first cycle if the bot is stopped during the stagger", async () => {
    mocks.botConfigRows = [buildConfigRow(RESUMED_USER)];
    await engine.resumeRunningBots();

    await engine.stopBot(RESUMED_USER);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(broker.getBrokerAccount).not.toHaveBeenCalled();
  });

  it("resumes a downgraded user into dry-run rather than live trading", async () => {
    // Restoration goes through startBot → runCycle, so the paywall boundary
    // still applies: a plan that lost live trading while the process was down
    // must not have real orders placed on its behalf at boot.
    mocks.plan.getPlanLimits.mockResolvedValue({
      liveTrading: false,
      aiTradeModes: false,
      maxInstruments: 3,
      aiQueriesPerDay: 10,
    });
    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });
    mocks.botConfigRows = [buildConfigRow(RESUMED_USER, { dryRun: false })];

    await engine.resumeRunningBots();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(broker.getBrokerAccount).toHaveBeenCalled(); // the cycle did run
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled(); // but placed nothing
  });
});

describe("minimum AI confidence — the model's own low-conviction calls can be discarded", () => {
  // Live evidence for why this exists: of the first twelve autonomous trades,
  // ten were placed on decisions the AI itself labelled "low" confidence.
  // Acting on those is the user overriding the model, not trusting it.
  const decision = (confidence: string) => [
    { ticker: "AAA", action: "BUY" as const, confidence, reason: "test" },
  ];

  it("skips an autonomous BUY whose confidence is below the floor", async () => {
    mocks.ai.decideTrades.mockResolvedValue(decision("low"));
    await startLiveBot({ aiTradeMode: "autonomous", minAiConfidence: "medium" });

    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("places the trade when confidence meets the floor", async () => {
    mocks.ai.decideTrades.mockResolvedValue(decision("medium"));
    await startLiveBot({ aiTradeMode: "autonomous", minAiConfidence: "medium" });

    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalled();
  });

  it("'any' preserves the original behaviour of acting on low confidence", async () => {
    // The default, so existing users see no change until they opt in.
    mocks.ai.decideTrades.mockResolvedValue(decision("low"));
    await startLiveBot({ aiTradeMode: "autonomous", minAiConfidence: "any" });

    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalled();
  });

  it("treats a missing or unrecognised confidence as the weakest", async () => {
    // Absence of a stated conviction is not evidence of a strong one.
    mocks.ai.decideTrades.mockResolvedValue([
      { ticker: "AAA", action: "BUY" as const, reason: "no confidence field" },
    ]);
    await startLiveBot({ aiTradeMode: "autonomous", minAiConfidence: "medium" });

    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });

  it("applies the same floor in guard mode, so it means one thing in both", async () => {
    mocks.ai.reviewSignal.mockResolvedValue({ approved: true, confidence: "low", reason: "weak but ok" });
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });
    await startLiveBot({ aiTradeMode: "guard", minAiConfidence: "high" });

    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
  });
});

describe("meetsConfidenceFloor", () => {
  it("ranks low < medium < high against each floor", () => {
    expect(engine.meetsConfidenceFloor("low", "any")).toBe(true);
    expect(engine.meetsConfidenceFloor("low", "medium")).toBe(false);
    expect(engine.meetsConfidenceFloor("medium", "medium")).toBe(true);
    expect(engine.meetsConfidenceFloor("medium", "high")).toBe(false);
    expect(engine.meetsConfidenceFloor("high", "high")).toBe(true);
  });

  it("is case-insensitive and defaults unknown values to low", () => {
    expect(engine.meetsConfidenceFloor("HIGH", "high")).toBe(true);
    expect(engine.meetsConfidenceFloor(undefined, "medium")).toBe(false);
    expect(engine.meetsConfidenceFloor("banana", "medium")).toBe(false);
  });
});

describe("fast engine — the cost gate is the point of scalp mode", () => {
  const scalpCfg = { strategyMode: "scalp" as const, minEdgeVsSpread: 3 };

  it("blocks a trade whose expected move cannot clear the spread", () => {
    // 0.05% expected against a 0.045% spread needing 3x (0.135%) — the exact
    // shape of trade that made 5-minute trading lose money in the sweep.
    expect(engine.clearsCostHurdle(scalpCfg, 0.0005, 0.00045)).toBe(false);
  });

  it("allows a trade whose expected move clears the multiple", () => {
    expect(engine.clearsCostHurdle(scalpCfg, 0.002, 0.00045)).toBe(true);
  });

  it("blocks when the spread is unknown — fails CLOSED, unlike the other quote checks", () => {
    // Market-status and min-size checks fail open because a skipped entry is
    // cheap. Cost is different: trading blind on it is the mistake the fast
    // engine exists to prevent.
    expect(engine.clearsCostHurdle(scalpCfg, 0.01, null)).toBe(false);
  });

  it("does not apply outside scalp mode", () => {
    // Slower strategies carry no move estimate; imposing the hurdle on them
    // would block trades on a number they never computed.
    expect(engine.clearsCostHurdle({ strategyMode: "auto", minEdgeVsSpread: 3 }, null, 0.05)).toBe(true);
  });

  it("is disabled by a zero multiple", () => {
    expect(engine.clearsCostHurdle({ strategyMode: "scalp", minEdgeVsSpread: 0 }, 0.00001, 0.05)).toBe(true);
  });

  it("explains the block in numbers the user can check", () => {
    const reason = engine.costHurdleReason({ minEdgeVsSpread: 3 }, 0.0005, 0.00045);
    expect(reason).toMatch(/0\.050%/);
    expect(reason).toMatch(/0\.045%/);
    expect(reason).toMatch(/0\.135%/);
  });

  it("says so plainly when the spread could not be read", () => {
    expect(engine.costHurdleReason({ minEdgeVsSpread: 3 }, 0.01, null)).toMatch(/could not be read/i);
  });
});

describe("fast engine — intraday drawdown halts from the peak, not the open", () => {
  it("stops the bot after giving back gains, even while still up on the day", async () => {
    // The case the day-start breaker cannot see: up 5%, then down 4% from the
    // high, is still "up" against the open while having lost most of the day.
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000)) // baseline + peak
      .mockResolvedValueOnce(account(1100)) // new peak
      .mockResolvedValue(account(1045)); // -5% from peak, still +4.5% on the day

    await startLiveBot({ maxIntradayDrawdownPercent: 2, maxDailyLossPercent: 0 });
    await engine.runCycle(TEST_USER_ID); // sets the higher peak
    await engine.runCycle(TEST_USER_ID); // observes the fall from it

    const status = await engine.getBotStatus(TEST_USER_ID);
    expect(status.circuitBreaker.tripped).toBe(true);
    expect(status.circuitBreaker.reason).toMatch(/peak/i);
    expect(status.running).toBe(false);
    expect(mocks.notify.notifyUser).toHaveBeenCalledWith(
      TEST_USER_ID,
      expect.objectContaining({ type: "circuit_breaker" }),
    );
  });

  it("does not trip while equity is making new highs", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000))
      .mockResolvedValueOnce(account(1050))
      .mockResolvedValue(account(1100));

    await startLiveBot({ maxIntradayDrawdownPercent: 2, maxDailyLossPercent: 0 });
    await engine.runCycle(TEST_USER_ID);
    await engine.runCycle(TEST_USER_ID);

    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(false);
  });

  it("is disabled by a zero threshold", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000))
      .mockResolvedValue(account(500)); // catastrophic, but the control is off

    await startLiveBot({ maxIntradayDrawdownPercent: 0, maxDailyLossPercent: 0 });
    await engine.runCycle(TEST_USER_ID);

    expect((await engine.getBotStatus(TEST_USER_ID)).circuitBreaker.tripped).toBe(false);
  });
});
