import { db, tradesTable, signalsTable, instrumentsTable, scannerResultsTable } from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { getBotStatus } from "./botEngine";
import { getBrokerAccount, getBrokerPositions, getBrokerQuote } from "./broker";
import { getUserBrokerCredentials } from "./brokerCredentialsService";
import { logger } from "./logger";

const PERSONA = `You are a day trading assistant for TradeBuzz, helping someone who is NOT an expert. You still review trade setups, spot patterns, explain why a strategy may be underperforming, and give risk guidance (position sizing, stop-losses, risk/reward) and market context — but you say it in a way a beginner can instantly understand.`;

const STYLE = `HOW TO REPLY — this matters most:
- Use very plain English. Short. Simple. Like explaining to a friend who is new to trading.
- Keep it brief: a few short sentences, or 3-5 short bullet points. No long paragraphs, no walls of text.
- Avoid jargon. If you must use a trading term, add a plain-words explanation in brackets right after it.
- Lead with the bottom line first, then the main reason in one simple sentence.
- Only add more detail if the user actually asks for it.
- If the data does not tell you something, say so plainly — never make up numbers.

WHAT YOU CAN SEE — be precise about this, it is the difference between useful and misleading:
- You DO have live prices from the broker, fetched the moment the user asked: the current price, today's move, the spread, whether the market is open, and which strategy and regime produced each signal. Use them. "SPCX is up 0.8% today" is something you can say.
- Never say you have no data at all when the live section below has prices in it.`;

/** Appended when the model has a working web-search tool. */
const CAN_SEARCH = `NEWS AND WHY SOMETHING IS MOVING:
- You have a web search tool. When the user asks WHY a market is moving, or asks about news, events or anything happening outside the price, SEARCH for it rather than answering from memory.
- Say where the information came from, and when it was published. A headline with no date is not evidence about today.
- Search only when the question actually needs the outside world. Price, spread, signals and the user's own account are already in the snapshot below; searching for those wastes time and money.
- If a search finds nothing useful, say so. Do not fill the gap from memory.`;

/** Appended when it does not. */
const CANNOT_SEARCH = `NEWS AND WHY SOMETHING IS MOVING:
- You do NOT have news, earnings, analyst comment or any fundamental data, and no way to look them up.
- So when asked WHY something is moving: say what the price action actually shows, then say plainly that you cannot see the news behind it.
- Do not guess at a cause, and do NOT repeat headlines from memory — anything you "recall" about current events is out of date and may be wrong. Suggest the user check a news source themselves.`;

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
      lines.push(`- Deposited funds: ${fmtMoney(account.invested, account.currency)}`);
      lines.push(`- Open P/L: ${fmtMoney(account.result, account.currency)}`);
      lines.push(
        `- Available margin for new trades: ${fmtMoney(account.cash, account.currency)} (can go negative if open positions are using more margin than the account currently supports)`
      );
      lines.push(
        `- These figures ARE consistent: Total balance = Deposited funds + Open P/L (${fmtMoney(account.invested, account.currency)} + ${fmtMoney(account.result, account.currency)} = ${fmtMoney(account.total, account.currency)}). "Available margin" is a separate figure and is NOT meant to add up with the others — never describe these numbers as not reconciling.`
      );
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

  // Live prices, fetched at the moment the user asks.
  //
  // Until now the assistant's freshest price was whatever the last cycle wrote
  // into the signals table — up to five minutes old — and it had no spread, no
  // intraday move and no idea whether the market was even open. Asked "why is
  // SPCX moving?", it could only say it had no data, which was true and
  // unhelpful: the broker will answer "is it moving, which way, and by how
  // much" in one call. It still cannot answer WHY, because nothing here
  // subscribes to news, and the prompt says so rather than letting the model
  // reach for its training data.
  const enabled = (
    await db.select().from(instrumentsTable).where(eq(instrumentsTable.userId, userId))
  ).filter((i) => i.enabled);

  if (credentials && enabled.length > 0) {
    // Today's first recorded price per instrument, for the intraday move. Taken
    // from our own signal log rather than a second broker call each — the bot
    // has been writing a price every cycle since the market opened.
    const since = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const todaysSignals = await db
      .select({ ticker: signalsTable.ticker, price: signalsTable.price, createdAt: signalsTable.createdAt })
      .from(signalsTable)
      .where(and(eq(signalsTable.userId, userId), gte(signalsTable.createdAt, since)))
      .orderBy(signalsTable.createdAt);
    const firstToday = new Map<string, { price: number; at: Date }>();
    for (const row of todaysSignals) {
      if (!firstToday.has(row.ticker)) firstToday.set(row.ticker, { price: Number(row.price), at: row.createdAt });
    }

    lines.push("");
    lines.push("## Live market (fetched just now, straight from the broker)");
    const quotes = await Promise.all(
      enabled.slice(0, 15).map(async (i) => {
        try {
          return { ticker: i.ticker, quote: await getBrokerQuote(userId, credentials, i.ticker) };
        } catch {
          return { ticker: i.ticker, quote: null };
        }
      }),
    );

    for (const { ticker, quote } of quotes) {
      if (!quote) {
        lines.push(`- ${ticker}: live price unavailable right now.`);
        continue;
      }
      const parts = [`price ${quote.price}`];
      const open = firstToday.get(ticker);
      if (open && open.price > 0) {
        const movePct = ((quote.price - open.price) / open.price) * 100;
        const dir = movePct > 0 ? "up" : movePct < 0 ? "down" : "flat";
        parts.push(`${dir} ${Math.abs(movePct).toFixed(2)}% today (from ${open.price} at ${open.at.toISOString().slice(11, 16)})`);
      }
      if (quote.price > 0 && quote.offer > quote.bid) {
        parts.push(`spread ${(((quote.offer - quote.bid) / quote.price) * 100).toFixed(3)}%`);
      }
      if (quote.marketStatus) parts.push(`market ${quote.marketStatus}`);
      if (quote.instrumentType) parts.push(quote.instrumentType.toLowerCase());
      lines.push(`- ${ticker}: ${parts.join(", ")}`);
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
      // The strategy matters: a mean-reversion BUY with price below both moving
      // averages is the setup, not a contradiction, and without naming it the
      // reader judges every signal by crossover rules.
      const how = [s.strategy, s.regime].filter(Boolean).join("/");
      const spread = s.spreadPct !== null ? `, spread ${(s.spreadPct * 100).toFixed(3)}%` : "";
      lines.push(
        `- ${s.createdAt.toISOString().slice(0, 16).replace("T", " ")} ${s.ticker}: ${s.signal}${how ? ` [${how}]` : ""} (shortMA ${s.shortMa}, longMA ${s.longMa}, price ${s.price}${spread})${s.tradeExecuted ? " → traded" : ""}`,
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

export async function buildSystemPrompt(
  userId: number,
  opts: { webSearch?: boolean } = {}
): Promise<string> {
  const context = await buildTradingContext(userId);
  return [
    PERSONA,
    "",
    STYLE,
    "",
    opts.webSearch ? CAN_SEARCH : CANNOT_SEARCH,
    "",
    DISCLAIMER,
    "",
    "Below is a live snapshot of the user's TradeBuzz account and activity, fetched fresh right now — right before this reply. Ground your analysis in THIS data and refer to specific tickers, trades, and signals when relevant. If something the user asks about is not covered by this data, say so rather than inventing numbers.",
    "",
    "LIVE DATA ALWAYS WINS: account balances and open positions change over time (deposits, withdrawals, closed trades). If anything said earlier in this conversation — by you or the user — conflicts with the snapshot below (e.g. an old balance, a position that no longer appears), the snapshot below is the current truth. Never restate or rely on an older figure from earlier in this thread once it's contradicted by the fresh snapshot.",
    "",
    context,
  ].join("\n");
}
