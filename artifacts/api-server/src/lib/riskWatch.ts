/**
 * Risk watch: what is dangerous about the positions open right now.
 *
 * Built after October 2026, when the account's closed oil trades made +£4,087
 * while four oil shorts — no stop-loss on any, each added at a worse price as
 * oil rose from 86.94 to 92.50 — reached −£6,786 open, plus −£1,118 in
 * charges. Every number was on a screen somewhere; nothing put them together
 * or said so. The bot made +£9.19 that month: the risk, not the strategy, was
 * what moved the account.
 *
 * It watches. It never places, changes or closes anything — this is the user's
 * own book, and what to do about it is theirs to decide.
 */

export interface RiskPosition {
  ticker: string;
  direction: "BUY" | "SELL";
  quantity: number;
  averagePrice: number;
  pnl: number;
  /** Null = the account's currency. */
  pnlCurrency: string | null;
  stopLevel: number | null;
  dealId: string | null;
  /** When the deal was opened (ISO), if the broker says. */
  openedAt: string | null;
  /** Size × price in the ACCOUNT's currency, if it could be worked out. */
  notionalAccount: number | null;
}

export interface RiskWatchSettings {
  enabled: boolean;
  /** Net exposure to one instrument, as a percent of equity, that raises a flag. 0 = off. */
  maxInstrumentPercent: number;
  /** Open loss, as a percent of the cash balance, that raises a flag — and each further step of it. 0 = off. */
  openLossPercent: number;
}

export type RiskKind = "no_stop" | "added_to_loser" | "concentration" | "open_loss";

export interface RiskFinding {
  kind: RiskKind;
  ticker: string | null;
  title: string;
  detail: string;
  /**
   * What makes this finding "already alerted". A finding is notified when any
   * of its keys is new: one key per unprotected deal, per deal added to a
   * loser, per instrument per day over the cap, per loss step per day.
   */
  keys: string[];
}

const fmtPrice = (n: number) => String(Number(n.toFixed(4)));
const fmtQty = (n: number) => String(Number(n.toFixed(4)));
function money(v: number, currency: string | null): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  const sign = v < 0 ? "−" : "";
  return symbol ? `${sign}${symbol}${Math.abs(v).toFixed(2)}` : `${sign}${Math.abs(v).toFixed(2)} ${currency ?? ""}`.trim();
}
const dealKey = (p: RiskPosition) => p.dealId ?? `${p.ticker}|${p.direction}|${p.averagePrice}|${p.openedAt ?? ""}`;

export function assessRisk(
  positions: RiskPosition[],
  account: { equity: number; cashBalance: number; currency: string | null },
  settings: RiskWatchSettings,
  now: Date
): RiskFinding[] {
  if (!settings.enabled || positions.length === 0) return [];
  const day = now.toISOString().slice(0, 10);
  const findings: RiskFinding[] = [];
  const tickers = [...new Set(positions.map((p) => p.ticker))];

  // 1. No stop-loss. Per instrument, so four unprotected deals are one alert —
  // but keyed per deal, so a fifth one added later alerts again.
  for (const ticker of tickers) {
    const deals = positions.filter((p) => p.ticker === ticker);
    const bare = deals.filter((p) => p.stopLevel === null);
    if (bare.length === 0) continue;
    const loss = bare.filter((p) => p.pnlCurrency === null).reduce((t, p) => t + p.pnl, 0);
    findings.push({
      kind: "no_stop",
      ticker,
      title: `${ticker}: ${bare.length === deals.length ? (deals.length === 1 ? "no stop-loss" : `no stop-loss on any of ${deals.length} deals`) : `no stop-loss on ${bare.length} of ${deals.length} deals`}`,
      detail:
        `Nothing limits how much ${bare.length === 1 ? "this position" : "these positions"} can lose. ` +
        (loss < 0 ? `Currently ${money(loss, account.currency)}. ` : "") +
        (bare.some((p) => p.direction === "SELL") ? "A short has no ceiling on its loss if the price keeps rising." : ""),
      keys: bare.map((p) => `nostop:${dealKey(p)}`),
    });
  }

  // 2. Added to a loser: a deal opened at a WORSE price than an earlier deal
  // in the same direction — a short sold higher, a long bought lower — so the
  // earlier one was losing when the new one went on.
  for (const ticker of tickers) {
    for (const direction of ["BUY", "SELL"] as const) {
      const deals = positions
        .filter((p) => p.ticker === ticker && p.direction === direction && p.openedAt)
        .sort((a, b) => Date.parse(a.openedAt!) - Date.parse(b.openedAt!));
      for (let i = 1; i < deals.length; i++) {
        const d = deals[i]!;
        const losing = deals
          .slice(0, i)
          .filter((e) => (direction === "SELL" ? d.averagePrice > e.averagePrice : d.averagePrice < e.averagePrice));
        if (losing.length === 0) continue;
        const first = losing[0]!;
        const side = direction === "SELL" ? "short" : "long";
        findings.push({
          kind: "added_to_loser",
          ticker,
          title: `${ticker}: added to a losing ${side}`,
          detail:
            `${d.openedAt!.slice(0, 10)}: another ${side} of ${fmtQty(d.quantity)} at ${fmtPrice(d.averagePrice)}, ` +
            `while the ${side} from ${first.openedAt!.slice(0, 10)} at ${fmtPrice(first.averagePrice)} was already losing. ` +
            `Each addition makes the same bet bigger as it goes wrong.`,
          keys: [`added:${dealKey(d)}`],
        });
      }
    }
  }

  // 3. Concentration: NET exposure to one instrument against equity. Net,
  // because a long and a short in the same instrument offset each other's
  // price risk (not their charges).
  if (settings.maxInstrumentPercent > 0 && account.equity > 0) {
    for (const ticker of tickers) {
      const deals = positions.filter((p) => p.ticker === ticker);
      if (deals.some((p) => p.notionalAccount === null)) continue; // cannot price it honestly
      const net = deals.reduce((t, p) => t + (p.direction === "BUY" ? 1 : -1) * p.notionalAccount!, 0);
      const pct = (Math.abs(net) / account.equity) * 100;
      if (pct < settings.maxInstrumentPercent) continue;
      findings.push({
        kind: "concentration",
        ticker,
        title: `${ticker}: ${Math.round(pct)}% of your equity on one instrument`,
        detail:
          `Net ${net >= 0 ? "long" : "short"} ${money(Math.abs(net), account.currency)} against equity of ` +
          `${money(account.equity, account.currency)} — your limit is ${settings.maxInstrumentPercent}%. ` +
          `A ${(100 / pct * 10).toFixed(1)}% move in ${ticker} moves your equity by 10%.`,
        keys: [`conc:${ticker}:${day}`],
      });
    }
  }

  // 4. Open loss against the cash balance, alerting again at each further
  // step: past 10%, again past 20%, and so on.
  if (settings.openLossPercent > 0 && account.cashBalance > 0) {
    const open = positions.filter((p) => p.pnlCurrency === null).reduce((t, p) => t + p.pnl, 0);
    const pct = (-open / account.cashBalance) * 100;
    if (pct >= settings.openLossPercent) {
      const step = Math.floor(pct / settings.openLossPercent);
      findings.push({
        kind: "open_loss",
        ticker: null,
        title: `Open positions are ${money(open, account.currency)} — ${Math.round(pct)}% of your balance`,
        detail:
          `Your cash balance is ${money(account.cashBalance, account.currency)}; with open positions counted, ` +
          `the account is worth ${money(account.equity, account.currency)}. Your alert level is ${settings.openLossPercent}%.`,
        keys: [`openloss:${day}:${step}`],
      });
    }
  }

  return findings;
}

/** One notification for everything new in a check, however many things it is. */
export function alertMessage(findings: RiskFinding[]): { title: string; body: string } {
  if (findings.length === 1) return { title: `Risk watch — ${findings[0]!.title}`, body: findings[0]!.detail };
  return {
    title: `Risk watch — ${findings.length} things need your attention`,
    body: findings.map((f) => `• ${f.title}\n  ${f.detail}`).join("\n\n"),
  };
}
