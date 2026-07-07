import { db, tradesTable, signalsTable, instrumentsTable, scannerResultsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getBotStatus } from "./botEngine";
import { getBrokerAccount, getBrokerPositions } from "./broker";
import { getUserBrokerCredentials } from "./brokerCredentialsService";
import { logger } from "./logger";

const PERSONA = `You are a day trading assistant for TradeBuzz, helping someone who is NOT an expert. You still review trade setups, spot patterns, explain why a strategy may be underperforming, and give risk guidance (position sizing, stop-losses, risk/reward) and market context — but you say it in a way a beginner can instantly understand.`;

const STYLE = `HOW TO REPLY — this matters most:
- Use very plain English. Short. Simple. Like explaining to a friend who is new to trading.
- Keep it brief: a few short sentences, or 3-5 short bullet points. No long paragraphs, no walls of text.
- Avoid jargon. If you must use a trading term, add a plain-words explanation in brackets right after it.
- Lead with the bottom line first, then the main reason in one simple sentence.
- Only add more detail if the user actually asks for it.
- If the data does not tell you something, say so plainly — never make up numbers.`;

const DISCLAIMER = `IMPORTANT: Always remind the user that trading involves substantial risk and that nothing you say constitutes financial advice. Include a brief, plain-language version of this reminder in every response.`;

function fmtMoney(n: number, currency: string | null): string {
  return `${currency ?? ""}${n.toFixed(2)}`.trim();
}

/**
 * Gathers a snapshot of the user's live TradeBuzz state and renders it as a
 * text block to ground the assistant's responses in the user's real activity.
 */
export async function buildTradingContext(userId: number): Promise<string> {
  const status = await getBotStatus(userId);
  const { config } = status;
  const broker = config.broker;

  const lines: string[] = [];

  lines.push("## Bot configuration");
  lines.push(
    `- Strategy: Moving Average crossover (short ${config.shortPeriod} / long ${config.longPeriod})`,
  );
  lines.push(`- Broker: ${broker}`);
  lines.push(`- Mode: ${config.dryRun ? "DRY RUN (paper trading)" : "LIVE (real orders)"}`);
  lines.push(`- Running: ${status.running ? "yes" : "no"}`);
  lines.push(
    `- Risk per trade: ${config.riskPerTradePercent}% (fixed amount fallback: ${config.tradeAmount})`,
  );
  lines.push(`- Stop loss: ${config.stopLossPercent}%`);
  lines.push(`- Check interval: ${config.intervalMinutes} min`);

  const credentials = await getUserBrokerCredentials(userId);

  if (!credentials) {
    lines.push("");
    lines.push("## Account");
    lines.push("- (No broker connected yet.)");
    lines.push("");
    lines.push("## Open positions");
    lines.push("- (No broker connected yet.)");
  } else {
    try {
      const account = await getBrokerAccount(userId, credentials);
      lines.push("");
      lines.push("## Account");
      lines.push(`- Total balance: ${fmtMoney(account.total, account.currency)}`);
      lines.push(`- Cash available: ${fmtMoney(account.cash, account.currency)}`);
      lines.push(`- Invested: ${fmtMoney(account.invested, account.currency)}`);
      lines.push(`- Open P/L: ${fmtMoney(account.result, account.currency)}`);
    } catch (err) {
      logger.warn({ userId, broker, err }, "Assistant context: could not fetch account");
      lines.push("");
      lines.push("## Account");
      lines.push("- (Account data unavailable — broker connection error.)");
    }

    try {
      const positions = await getBrokerPositions(userId, credentials);
      lines.push("");
      lines.push("## Open positions");
      if (positions.length === 0) {
        lines.push("- None.");
      } else {
        for (const p of positions.slice(0, 25)) {
          lines.push(
            `- ${p.ticker}: qty ${p.quantity}, avg ${p.averagePrice}, current ${p.currentPrice}, P/L ${p.pnl.toFixed(2)} (${p.pnlPercent.toFixed(2)}%)`,
          );
        }
      }
    } catch (err) {
      logger.warn({ userId, broker, err }, "Assistant context: could not fetch positions");
      lines.push("");
      lines.push("## Open positions");
      lines.push("- (Positions unavailable — broker connection error.)");
    }
  }

  const instruments = await db.select().from(instrumentsTable).where(eq(instrumentsTable.userId, userId));
  lines.push("");
  lines.push("## Watchlist");
  if (instruments.length === 0) {
    lines.push("- Empty.");
  } else {
    for (const i of instruments) {
      lines.push(`- ${i.ticker} (${i.name})${i.enabled ? "" : " [disabled]"}`);
    }
  }

  const trades = await db
    .select()
    .from(tradesTable)
    .where(eq(tradesTable.userId, userId))
    .orderBy(desc(tradesTable.executedAt))
    .limit(20);
  lines.push("");
  lines.push("## Recent trades (latest 20)");
  if (trades.length === 0) {
    lines.push("- None yet.");
  } else {
    for (const t of trades) {
      lines.push(
        `- ${t.executedAt.toISOString().slice(0, 16).replace("T", " ")} ${t.side} ${t.ticker} qty ${t.quantity} @ ${t.price} [${t.status}]${t.errorMessage ? ` (${t.errorMessage})` : ""}`,
      );
    }
  }

  const signals = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.userId, userId))
    .orderBy(desc(signalsTable.createdAt))
    .limit(20);
  lines.push("");
  lines.push("## Recent signals (latest 20)");
  if (signals.length === 0) {
    lines.push("- None yet.");
  } else {
    for (const s of signals) {
      lines.push(
        `- ${s.createdAt.toISOString().slice(0, 16).replace("T", " ")} ${s.ticker}: ${s.signal} (shortMA ${s.shortMa}, longMA ${s.longMa}, price ${s.price})${s.tradeExecuted ? " → traded" : ""}`,
      );
    }
  }

  const scans = await db
    .select()
    .from(scannerResultsTable)
    .where(eq(scannerResultsTable.userId, userId))
    .orderBy(desc(scannerResultsTable.scannedAt))
    .limit(15);
  lines.push("");
  lines.push("## Recent market scanner hits (latest 15)");
  if (scans.length === 0) {
    lines.push("- None yet.");
  } else {
    for (const s of scans) {
      lines.push(
        `- ${s.ticker} (${s.name}): ${s.signal}, trend strength ${s.trendStrength}, price ${s.price}${s.autoTraded ? " [auto-traded]" : ""}`,
      );
    }
  }

  return lines.join("\n");
}

export async function buildSystemPrompt(userId: number): Promise<string> {
  const context = await buildTradingContext(userId);
  return [
    PERSONA,
    "",
    STYLE,
    "",
    DISCLAIMER,
    "",
    "Below is a live snapshot of the user's TradeBuzz account and activity. Ground your analysis in this data and refer to specific tickers, trades, and signals when relevant. If something the user asks about is not covered by this data, say so rather than inventing numbers.",
    "",
    context,
  ].join("\n");
}
