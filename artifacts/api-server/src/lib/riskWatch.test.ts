import { describe, it, expect } from "vitest";
import { assessRisk, alertMessage, type RiskPosition, type RiskWatchSettings } from "./riskWatch";
import { accountNotionals } from "./positionPnl";

// The account on 23 Oct 2026: four OIL_CRUDE shorts of 200, each sold higher as
// oil rose, plus a 1,000 long. GBP account, oil priced in USD (≈0.747 £/$).
const NOW = new Date("2026-10-23T13:00:00Z");
const RATE = 0.747;
const PRICE = 100.65;
const short = (entry: number, opened: string, stop: number | null = null): RiskPosition => ({
  ticker: "OIL_CRUDE", direction: "SELL", quantity: 200, averagePrice: entry,
  pnl: -(PRICE - entry) * 200 * RATE, pnlCurrency: null, stopLevel: stop, dealId: `s${entry}`,
  openedAt: opened, notionalAccount: 200 * PRICE * RATE,
});
const long1000: RiskPosition = {
  ticker: "OIL_CRUDE", direction: "BUY", quantity: 1000, averagePrice: 100.858,
  pnl: -(100.858 - PRICE) * 1000 * RATE, pnlCurrency: null, stopLevel: 99.5, dealId: "l1",
  openedAt: "2026-10-23T11:06:54Z", notionalAccount: 1000 * PRICE * RATE,
};
const oilShorts = [
  short(86.944, "2026-10-06T14:10:13Z"),
  short(88.606, "2026-10-07T20:28:09Z"),
  short(90.62, "2026-10-12T08:25:43Z"),
  short(92.501, "2026-10-13T13:53:34Z"),
];
const ACCOUNT = { equity: 7857.84, cashBalance: 14643.9, currency: "GBP" };
const ON: RiskWatchSettings = { enabled: true, maxInstrumentPercent: 300, openLossPercent: 10 };
const kinds = (fs: ReturnType<typeof assessRisk>) => fs.map((f) => f.kind);

describe("risk watch — the October oil book", () => {
  const findings = assessRisk([...oilShorts, long1000], ACCOUNT, ON, NOW);

  it("flags the shorts with no stop as one finding, counting them", () => {
    const f = findings.filter((x) => x.kind === "no_stop");
    expect(f).toHaveLength(1);
    expect(f[0]!.title).toBe("OIL_CRUDE: no stop-loss on 4 of 5 deals");
    expect(f[0]!.detail).toMatch(/no ceiling/);
    expect(f[0]!.keys).toHaveLength(4); // one per deal: a fifth bare deal alerts again
  });

  it("flags every short sold higher while the first was losing — and not the first", () => {
    const f = findings.filter((x) => x.kind === "added_to_loser");
    expect(f.map((x) => x.keys[0])).toEqual(["added:s88.606", "added:s90.62", "added:s92.501"]);
    expect(f[2]!.detail).toMatch(/2026-10-13: another short of 200 at 92\.501, while the short from 2026-10-06 at 86\.944/);
  });

  it("flags the open loss with its share of the cash balance", () => {
    const f = findings.find((x) => x.kind === "open_loss")!;
    expect(f.title).toMatch(/^Open positions are −£\d+\.\d\d — 4[0-9]% of your balance$/);
    expect(f.keys).toEqual(["openloss:2026-10-23:4"]); // 40-49% = the 4th step of 10%
  });

  it("measures concentration NET: the long and the shorts offset each other", () => {
    // ≈ £75k long − £60k short = £15k net ≈ 191% of equity: under 300, flagged under 150.
    expect(kinds(findings)).not.toContain("concentration");
    const tight = assessRisk([...oilShorts, long1000], ACCOUNT, { ...ON, maxInstrumentPercent: 150 }, NOW);
    const f = tight.find((x) => x.kind === "concentration")!;
    expect(f.title).toMatch(/^OIL_CRUDE: 19\d% of your equity on one instrument$/);
    expect(f.detail).toMatch(/Net long/);
  });
});

describe("risk watch — rules", () => {
  it("does not flag adding at a BETTER price (a short sold higher after a fall is not adding to a loser)", () => {
    const fs = assessRisk([short(92.5, "2026-10-01T10:00:00Z", 95), short(88, "2026-10-02T10:00:00Z", 95)], ACCOUNT, ON, NOW);
    expect(kinds(fs)).not.toContain("added_to_loser");
  });

  it("mirrors the rule for longs: bought lower while an earlier long was losing", () => {
    const l = (entry: number, opened: string): RiskPosition => ({ ...long1000, averagePrice: entry, openedAt: opened, dealId: `l${entry}` });
    const fs = assessRisk([l(105, "2026-10-01T10:00:00Z"), l(101, "2026-10-02T10:00:00Z")], ACCOUNT, ON, NOW);
    expect(fs.filter((f) => f.kind === "added_to_loser").map((f) => f.keys[0])).toEqual(["added:l101"]);
  });

  it("raises the open-loss alert again at each further step, not every check", () => {
    const at = (loss: number) =>
      assessRisk([{ ...long1000, pnl: -loss }], { ...ACCOUNT, cashBalance: 10000 }, ON, NOW).find((f) => f.kind === "open_loss")?.keys[0];
    expect(at(900)).toBeUndefined();
    expect(at(1000)).toBe("openloss:2026-10-23:1");
    expect(at(1900)).toBe("openloss:2026-10-23:1"); // same step: no new alert
    expect(at(2100)).toBe("openloss:2026-10-23:2");
  });

  it("does not count a loss it can only see in another currency", () => {
    const usd = { ...long1000, pnl: -5000, pnlCurrency: "USD" };
    expect(kinds(assessRisk([usd], { ...ACCOUNT, cashBalance: 10000 }, ON, NOW))).not.toContain("open_loss");
  });

  it("skips concentration it cannot price rather than guessing", () => {
    const unknown = { ...long1000, notionalAccount: null };
    expect(kinds(assessRisk([unknown], ACCOUNT, { ...ON, maxInstrumentPercent: 1 }, NOW))).not.toContain("concentration");
  });

  it("is silent when switched off, and each check can be turned off on its own", () => {
    expect(assessRisk([...oilShorts], ACCOUNT, { ...ON, enabled: false }, NOW)).toEqual([]);
    const fs = assessRisk([...oilShorts], ACCOUNT, { enabled: true, maxInstrumentPercent: 0, openLossPercent: 0 }, NOW);
    expect(kinds(fs)).not.toContain("open_loss");
    expect(kinds(fs)).not.toContain("concentration");
  });

  it("gives the same keys for the same book, so a repeat check alerts nothing new", () => {
    const a = assessRisk([...oilShorts, long1000], ACCOUNT, ON, NOW).flatMap((f) => f.keys);
    const b = assessRisk([...oilShorts, long1000], ACCOUNT, ON, new Date("2026-10-23T13:05:00Z")).flatMap((f) => f.keys);
    expect(b).toEqual(a);
  });
});

describe("alertMessage", () => {
  const fs = assessRisk([...oilShorts, long1000], ACCOUNT, ON, NOW);
  it("sends one finding as itself", () => {
    expect(alertMessage([fs[0]!]).title).toBe(`Risk watch — ${fs[0]!.title}`);
  });
  it("sends several as one notification listing all of them", () => {
    const m = alertMessage(fs);
    expect(m.title).toBe(`Risk watch — ${fs.length} things need your attention`);
    for (const f of fs) expect(m.body).toContain(f.title);
  });
});

describe("accountNotionals", () => {
  const item = (notional: number, pnl: number, computedPnl: number, pnlCurrency: string | null = null) => ({ notional, currency: "USD", pnl, pnlCurrency, computedPnl });

  it("converts with the rate each position is settled at: broker P&L ÷ price P&L", () => {
    // −£1,217.68 on −$1,629.40 (23 Oct) → 0.7473 £/$
    expect(accountNotionals([item(20129, -1217.68, -1629.4)])[0]).toBeCloseTo(20129 * (1217.68 / 1629.4), 2);
  });

  it("lends a just-opened position (P&L ≈ 0) the rate of others in its currency", () => {
    const r = accountNotionals([item(20000, -747, -1000), item(100000, 0, 0)]);
    expect(r[1]).toBeCloseTo(74700, 0);
  });

  it("guesses nothing when no rate can be read", () => {
    expect(accountNotionals([item(100000, 0, 0)])).toEqual([null]);
    expect(accountNotionals([item(100000, -1000, -1000, "USD")])).toEqual([null]); // P&L not in account currency
  });
});
