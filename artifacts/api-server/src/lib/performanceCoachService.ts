import { db, tradesTable, type Trade } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { asString, generateClaudeJson } from "./aiJson";

export const COACH_DISCLAIMER =
  "AI-generated coaching based on your trade history. Not financial advice.";

export interface InstrumentPnl {
  ticker: string;
  netPnl: number;
  trades: number;
}

export interface PerformanceCoach {
  totalTrades: number;
  closedTrades: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  bestInstrument: InstrumentPnl | null;
  worstInstrument: InstrumentPnl | null;
  overtradingWarning: string | null;
  riskDisciplineScore: number;
  suggestedImprovement: string;
  disclaimer: string;
}

interface RoundTrip {
  ticker: string;
  pnl: number;
}

/**
 * Pairs BUY/SELL fills per ticker with FIFO matching to derive realized
 * round-trip P/L. Trades only log orders (side/qty/price), so realized results
 * must be reconstructed here. Purely deterministic — no LLM involved.
 */
function computeRoundTrips(trades: Trade[]): RoundTrip[] {
  // Oldest first for FIFO.
  const ordered = [...trades].sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
  );
  const byTicker = new Map<string, Trade[]>();
  for (const t of ordered) {
    if (t.status === "FAILED") continue;
    const list = byTicker.get(t.ticker) ?? [];
    list.push(t);
    byTicker.set(t.ticker, list);
  }

  const roundTrips: RoundTrip[] = [];
  for (const [ticker, list] of byTicker) {
    // Open lots keyed by side; match a closing order against the opposite side.
    const longs: Array<{ qty: number; price: number }> = [];
    const shorts: Array<{ qty: number; price: number }> = [];
    for (const t of list) {
      let qty = Number(t.quantity);
      const price = Number(t.price);
      if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0) continue;
      if (t.side === "BUY") {
        // Close shorts first (buy to cover), then open a long with the rest.
        while (qty > 0 && shorts.length > 0) {
          const lot = shorts[0];
          const matched = Math.min(qty, lot.qty);
          roundTrips.push({ ticker, pnl: (lot.price - price) * matched });
          lot.qty -= matched;
          qty -= matched;
          if (lot.qty <= 1e-9) shorts.shift();
        }
        if (qty > 0) longs.push({ qty, price });
      } else {
        // SELL: close longs first, then open a short with the rest.
        while (qty > 0 && longs.length > 0) {
          const lot = longs[0];
          const matched = Math.min(qty, lot.qty);
          roundTrips.push({ ticker, pnl: (price - lot.price) * matched });
          lot.qty -= matched;
          qty -= matched;
          if (lot.qty <= 1e-9) longs.shift();
        }
        if (qty > 0) shorts.push({ qty, price });
      }
    }
  }
  return roundTrips;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

export async function computePerformanceCoach(userId: number): Promise<PerformanceCoach> {
  const trades = await db
    .select()
    .from(tradesTable)
    .where(eq(tradesTable.userId, userId))
    .orderBy(desc(tradesTable.executedAt))
    .limit(500);

  const roundTrips = computeRoundTrips(trades);
  const wins = roundTrips.filter((r) => r.pnl > 0);
  const losses = roundTrips.filter((r) => r.pnl < 0);
  const closedTrades = roundTrips.length;

  const winRate = closedTrades > 0 ? round2((wins.length / closedTrades) * 100) : null;
  const avgWin =
    wins.length > 0 ? round2(wins.reduce((s, r) => s + r.pnl, 0) / wins.length) : null;
  const avgLoss =
    losses.length > 0
      ? round2(losses.reduce((s, r) => s + r.pnl, 0) / losses.length)
      : null;

  // Net P/L per instrument.
  const perTicker = new Map<string, InstrumentPnl>();
  for (const r of roundTrips) {
    const cur = perTicker.get(r.ticker) ?? { ticker: r.ticker, netPnl: 0, trades: 0 };
    cur.netPnl += r.pnl;
    cur.trades += 1;
    perTicker.set(r.ticker, cur);
  }
  const rankedTickers = [...perTicker.values()].map((t) => ({
    ...t,
    netPnl: round2(t.netPnl),
  }));
  const bestInstrument =
    rankedTickers.length > 0
      ? rankedTickers.reduce((a, b) => (b.netPnl > a.netPnl ? b : a))
      : null;
  const worstInstrument =
    rankedTickers.length > 0
      ? rankedTickers.reduce((a, b) => (b.netPnl < a.netPnl ? b : a))
      : null;

  // Overtrading: many fills within the most recent 24h window.
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = trades.filter((t) => t.executedAt.getTime() >= dayAgo).length;
  const overtradingWarning =
    last24h >= 15
      ? `You placed ${last24h} orders in the last 24 hours — that pace can signal overtrading. Consider fewer, higher-quality setups.`
      : null;

  // Risk discipline heuristic (0-100): reward a positive win rate and a
  // sensible win/loss ratio, penalise overtrading.
  let riskDisciplineScore = 50;
  if (winRate != null) riskDisciplineScore += Math.round((winRate - 50) * 0.6);
  if (avgWin != null && avgLoss != null && avgLoss !== 0) {
    const ratio = avgWin / Math.abs(avgLoss);
    riskDisciplineScore += Math.round(Math.min(20, (ratio - 1) * 20));
  }
  if (overtradingWarning) riskDisciplineScore -= 15;
  riskDisciplineScore = Math.max(0, Math.min(100, riskDisciplineScore));

  let suggestedImprovement =
    closedTrades === 0
      ? "You have no closed round-trip trades yet. Once you do, this coach will highlight your win rate, best and worst instruments, and one concrete thing to improve."
      : "Keep position sizes consistent and let winners run while cutting losers quickly.";

  if (closedTrades > 0) {
    try {
      const parsed = await generateClaudeJson(
        `You are a supportive trading coach. Based on the stats below, give ONE concrete, plain-language improvement suggestion (2-3 short sentences). Be encouraging and specific. Do NOT give buy/sell advice.
Closed round-trip trades: ${closedTrades}
Win rate: ${winRate ?? "n/a"}%
Average win: ${avgWin ?? "n/a"}
Average loss: ${avgLoss ?? "n/a"}
Best instrument: ${bestInstrument ? `${bestInstrument.ticker} (${bestInstrument.netPnl})` : "n/a"}
Worst instrument: ${worstInstrument ? `${worstInstrument.ticker} (${worstInstrument.netPnl})` : "n/a"}
Overtrading: ${overtradingWarning ? "yes" : "no"}

Respond with ONLY JSON: { "suggestedImprovement": string }`,
        { maxTokens: 400 },
      );
      const aiText = asString(parsed["suggestedImprovement"]);
      if (aiText) suggestedImprovement = aiText;
    } catch {
      // Keep the deterministic fallback suggestion.
    }
  }

  return {
    totalTrades: trades.length,
    closedTrades,
    winRate,
    avgWin,
    avgLoss,
    bestInstrument,
    worstInstrument,
    overtradingWarning,
    riskDisciplineScore,
    suggestedImprovement,
    disclaimer: COACH_DISCLAIMER,
  };
}
