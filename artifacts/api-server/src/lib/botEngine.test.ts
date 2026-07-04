import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NormalizedAccount, NormalizedPosition } from "./broker";
import type { BotConfig } from "./botEngine";

/**
 * Shared mock surface for botEngine's dependencies. Everything botEngine touches
 * at import time (the DB pool, broker HTTP clients, the AI trader, the pino
 * logger) is replaced so the risk-control logic can be exercised in isolation
 * with no real network, DB, or side effects.
 */
const mocks = vi.hoisted(() => ({
  enabledInstruments: [] as Array<{ ticker: string; enabled: boolean }>,
  broker: {
    getBrokerAccount: vi.fn(),
    getBrokerPositions: vi.fn(),
    getBrokerPriceHistory: vi.fn(),
    placeBrokerOrder: vi.fn(),
  },
  ma: { computeMASignal: vi.fn() },
  ai: { reviewSignal: vi.fn(), decideTrades: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(mocks.enabledInstruments) }),
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  },
  instrumentsTable: { __name: "instruments" },
  tradesTable: { __name: "trades" },
  signalsTable: { __name: "signals" },
}));

// Keep everything from drizzle-orm except eq, which botEngine calls with a
// mocked (column-less) table. A no-op eq avoids drizzle inspecting the column.
vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => ({})),
}));

vi.mock("./broker", () => mocks.broker);
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

function position(ticker: string, quantity: number): NormalizedPosition {
  return {
    ticker,
    quantity,
    averagePrice: 100,
    currentPrice: 100,
    pnl: 0,
    pnlPercent: 0,
  };
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
    regimeFilterEnabled: false,
    costPerTradePercent: 0,
    ...patch,
  };
}

/** Let all queued microtasks / floating promises (e.g. startBot's first cycle) settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

let engine: typeof import("./botEngine");

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.enabledInstruments = [];
  broker.getBrokerAccount.mockResolvedValue(defaultAccount);
  broker.getBrokerPositions.mockResolvedValue([]);
  broker.getBrokerPriceHistory.mockResolvedValue(defaultPrices);
  broker.placeBrokerOrder.mockResolvedValue({ id: "order-1" });
  ma.computeMASignal.mockReturnValue({ signal: "HOLD", shortMa: 1, longMa: 1 });

  // Fresh module = fresh in-memory bot state (running flag + circuit breaker).
  vi.resetModules();
  engine = await import("./botEngine");
});

afterEach(() => {
  // Clear the interval startBot may have scheduled so timers don't leak.
  try {
    engine.stopBot();
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
  engine.updateConfig(buildConfig({ dryRun: false, ...patch }));
  engine.startBot();
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
    const results = await engine.runCycle();

    // Only the closing SELL on the already-held ticker reaches the broker.
    const orders = broker.placeBrokerOrder.mock.calls;
    expect(orders).toHaveLength(1);
    expect(orders[0][1]).toBe("HELD");
    expect(orders[0][3]).toBe("SELL");

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
    const results = await engine.runCycle();

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
    const results = await engine.runCycle();

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results.find((r) => r.ticker === "HELD")?.tradeExecuted).toBe(false);
  });

  it("also blocks a SELL that would open a NEW short when risk data is unavailable (a short is a new position)", async () => {
    broker.getBrokerAccount.mockRejectedValue(new Error("broker down"));
    broker.getBrokerPositions.mockResolvedValue([]); // nothing held → SELL opens a short
    ma.computeMASignal.mockReturnValue({ signal: "SELL", shortMa: 1, longMa: 2 });

    await startLiveBot();
    mocks.enabledInstruments = [{ ticker: "NEWSHORT", enabled: true }];
    const results = await engine.runCycle();

    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();
    expect(results.find((r) => r.ticker === "NEWSHORT")?.tradeExecuted).toBe(false);
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
    const results = await engine.runCycle();

    // Adding to the existing AAA is allowed; opening the new CCC is blocked.
    const orderedTickers = broker.placeBrokerOrder.mock.calls.map((c) => c[1]);
    expect(orderedTickers).toEqual(["AAA"]);
    expect(results.find((r) => r.ticker === "CCC")?.tradeExecuted).toBe(false);
    expect(results.find((r) => r.ticker === "AAA")?.tradeExecuted).toBe(true);
  });

  it("a repeated BUY on the same held ticker never consumes an extra slot even at the limit", async () => {
    broker.getBrokerPositions.mockResolvedValue([position("AAA", 5)]);
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });

    await startLiveBot({ maxConcurrentPositions: 1 }); // already at the 1-slot limit
    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    const results = await engine.runCycle();

    expect(broker.placeBrokerOrder.mock.calls.map((c) => c[1])).toEqual(["AAA"]);
    expect(results.find((r) => r.ticker === "AAA")?.tradeExecuted).toBe(true);
  });
});

describe("daily-loss circuit breaker", () => {
  it("captures the first equity of the UTC day as the loss baseline", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount.mockResolvedValue(account(1000));

    await startLiveBot({ maxDailyLossPercent: 3 });

    const status = engine.getBotStatus();
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
    await engine.runCycle();

    const status = engine.getBotStatus();
    expect(status.circuitBreaker.tripped).toBe(false);
    expect(status.running).toBe(true);
  });

  it("trips and stops the bot when the daily loss reaches the limit", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000)) // baseline
      .mockResolvedValue(account(900)); // 10% loss ≥ 3%

    await startLiveBot({ maxDailyLossPercent: 3 });
    await engine.runCycle(); // observes the loss → trips

    const status = engine.getBotStatus();
    expect(status.circuitBreaker.tripped).toBe(true);
    expect(status.circuitBreaker.reason).toMatch(/limit/i);
    expect(status.running).toBe(false);
  });

  it("stays halted across further cycles and is NOT cleared by starting the bot again", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000))
      .mockResolvedValue(account(900));

    await startLiveBot({ maxDailyLossPercent: 3 });
    await engine.runCycle(); // trip

    // A tripped breaker skips the cycle entirely — no orders are placed.
    mocks.enabledInstruments = [{ ticker: "AAA", enabled: true }];
    ma.computeMASignal.mockReturnValue({ signal: "BUY", shortMa: 2, longMa: 1 });
    await engine.runCycle();
    expect(broker.placeBrokerOrder).not.toHaveBeenCalled();

    // Restarting the bot does not clear the breaker.
    engine.startBot();
    await flush();
    expect(engine.getBotStatus().circuitBreaker.tripped).toBe(true);
  });

  it("clears only via resumeBot, which resets the baseline and resumes trading", async () => {
    broker.getBrokerAccount.mockReset();
    broker.getBrokerAccount
      .mockResolvedValueOnce(account(1000))
      .mockResolvedValue(account(900));

    await startLiveBot({ maxDailyLossPercent: 3 });
    await engine.runCycle(); // trip
    expect(engine.getBotStatus().circuitBreaker.tripped).toBe(true);

    engine.resumeBot();
    await flush();

    const status = engine.getBotStatus();
    expect(status.circuitBreaker.tripped).toBe(false);
    expect(status.running).toBe(true);
    // Baseline re-measured from the resume point (the 900 equity now in effect).
    expect(status.circuitBreaker.dayStartEquity).toBe(900);
  });
});
