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
  broker: {
    getBrokerAccount: vi.fn(),
    getBrokerPositions: vi.fn(),
    getBrokerPriceHistory: vi.fn(),
    getBrokerQuote: vi.fn(),
    placeBrokerOrder: vi.fn(),
  },
  ma: { computeMASignal: vi.fn() },
  ai: { reviewSignal: vi.fn(), decideTrades: vi.fn() },
  credentials: { getUserBrokerCredentials: vi.fn() },
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
      from: () => ({ where: () => Promise.resolve(mocks.enabledInstruments) }),
    }),
    insert: () => ({ values: () => insertResult() }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
  instrumentsTable: { __name: "instruments" },
  tradesTable: { __name: "trades" },
  signalsTable: { __name: "signals" },
  botConfigTable: { __name: "bot_config", userId: "user_id" },
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
  });
  broker.placeBrokerOrder.mockResolvedValue({ id: "order-1" });
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

afterEach(() => {
  // Clear the interval startBot may have scheduled so timers don't leak.
  try {
    engine.stopBot(TEST_USER_ID);
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
    const orders = broker.placeBrokerOrder.mock.calls;
    expect(orders).toHaveLength(1);
    expect(orders[0][2]).toBe("HELD");
    expect(orders[0][4]).toBe("SELL");

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
      marketStatus: "CLOSED",
      currency: "GBP",
      minDealSize: 9999, // far above the held quantity (10) — must not block the close
    });
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(1);
    const [, , ticker, quantity, side] = broker.placeBrokerOrder.mock.calls[0];
    expect(ticker).toBe("CLOSEDMKT");
    expect(quantity).toBe(10);
    expect(side).toBe("SELL");
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

describe("flatten-by-close", () => {
  it("closes a held long position when its market is confirmed closed", async () => {
    // Positions are set up before startLiveBot(), but the default
    // getBrokerQuote mock (beforeEach) returns TRADEABLE, so startLiveBot's
    // own implicit first cycle does not flatten anything — only the
    // TRADEABLE→CLOSED override below, applied after, triggers the flatten
    // on the explicit runCycle() call.
    broker.getBrokerPositions.mockResolvedValue([position("CLOSEDMKT", 10)]); // long, direction BUY
    await startLiveBot();

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "CLOSEDMKT",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "CLOSED",
      currency: "GBP",
      minDealSize: null,
    });
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(1);
    const [, , ticker, quantity, side, stopLoss, takeProfit] = broker.placeBrokerOrder.mock.calls[0];
    expect(ticker).toBe("CLOSEDMKT");
    expect(quantity).toBe(10);
    expect(side).toBe("SELL"); // opposite of the long's BUY direction — a close, not a new short
    // A closing order never carries a new stop-loss/take-profit, even though
    // buildConfig() sets non-zero stopLossPercent/takeProfitPercent.
    expect(stopLoss).toBeUndefined();
    expect(takeProfit).toBeUndefined();
  });

  it("closes a held short position with a BUY (opposite of SELL)", async () => {
    broker.getBrokerPositions.mockResolvedValue([position("SHORTED", 4, "SELL")]);
    await startLiveBot();

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "SHORTED",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "CLOSED",
      currency: "GBP",
      minDealSize: null,
    });
    mocks.enabledInstruments = [];
    await engine.runCycle(TEST_USER_ID);

    const [, , ticker, quantity, side] = broker.placeBrokerOrder.mock.calls[0];
    expect(ticker).toBe("SHORTED");
    expect(quantity).toBe(4);
    expect(side).toBe("BUY");
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

  it("dry-run flatten never calls the broker, even when the market is confirmed closed", async () => {
    broker.getBrokerPositions.mockResolvedValue([position("CLOSEDMKT", 10)]);
    await startLiveBot({ dryRun: true }); // runCycle's dryRun is true regardless (cfg.dryRun || !running)

    broker.getBrokerQuote.mockResolvedValue({
      ticker: "CLOSEDMKT",
      bid: 100,
      offer: 100,
      price: 100,
      marketStatus: "CLOSED",
      currency: "GBP",
      minDealSize: null,
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
      marketStatus: "CLOSED",
      currency: "GBP",
      minDealSize: null,
    });
    mocks.enabledInstruments = [];

    broker.placeBrokerOrder.mockRejectedValueOnce(new Error("broker rejected the close"));
    await engine.runCycle(TEST_USER_ID);
    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(1);

    // Position is still reported open by the broker (mock unchanged) — the
    // next cycle attempts the close again, same retry behavior as any other
    // trade failure.
    broker.placeBrokerOrder.mockResolvedValueOnce({ id: "order-2" });
    await engine.runCycle(TEST_USER_ID);
    expect(broker.placeBrokerOrder).toHaveBeenCalledTimes(2);
  });
});
