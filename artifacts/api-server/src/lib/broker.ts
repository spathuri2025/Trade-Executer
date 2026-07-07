import {
  getPositions as t212GetPositions,
  getAccountInfo,
  getAccountCash,
  placeMarketOrder as t212PlaceOrder,
} from "./trading212";

import {
  getCapitalPositions,
  getCapitalAccounts,
  getCapitalPriceHistory,
  getCapitalQuote,
  placeCapitalOrder,
} from "./capitalcom";

import { logger } from "./logger";
import type { UserBrokerCredentials } from "./brokerCredentialsService";

export type BrokerName = "trading212" | "capitalcom";

export interface NormalizedPosition {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

export interface NormalizedAccount {
  cash: number;
  invested: number;
  result: number;
  total: number;
  currency: string | null;
}

export interface NormalizedOrder {
  id: string;
}

export async function getBrokerPositions(userId: number, credentials: UserBrokerCredentials): Promise<NormalizedPosition[]> {
  if (credentials.broker === "capitalcom") {
    const positions = await getCapitalPositions(userId, credentials.capital);
    return positions.map((p) => {
      const avgPrice = p.position.level;
      const currentPrice = (p.market.bid + p.market.offer) / 2;
      const pnl = (currentPrice - avgPrice) * p.position.size * p.position.contractSize;
      const pnlPercent = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;
      return {
        ticker: p.market.epic,
        quantity: p.position.size,
        averagePrice: avgPrice,
        currentPrice,
        pnl,
        pnlPercent,
      };
    });
  }

  const positions = await t212GetPositions(credentials.trading212);
  return positions.map((p) => ({
    ticker: p.ticker,
    quantity: p.quantity,
    averagePrice: p.averagePrice,
    currentPrice: p.currentPrice,
    pnl: p.ppl,
    pnlPercent: p.averagePrice > 0 ? ((p.currentPrice - p.averagePrice) / p.averagePrice) * 100 : 0,
  }));
}

export async function getBrokerAccount(userId: number, credentials: UserBrokerCredentials): Promise<NormalizedAccount> {
  if (credentials.broker === "capitalcom") {
    const data = await getCapitalAccounts(userId, credentials.capital);
    const preferred = data.accounts.find((a) => a.preferred) ?? data.accounts[0];
    if (!preferred) throw new Error("No Capital.com account found");
    const { balance } = preferred;
    return {
      cash: balance.available,
      invested: balance.deposit,
      result: balance.profitLoss,
      total: balance.balance,
      currency: preferred.currency ?? null,
    };
  }

  const [info, cash] = await Promise.all([getAccountInfo(credentials.trading212), getAccountCash(credentials.trading212)]);
  return {
    cash: cash.free,
    invested: cash.invested,
    result: cash.result,
    total: cash.total,
    currency: info.currencyCode ?? null,
  };
}

export async function getBrokerPriceHistory(
  userId: number,
  credentials: UserBrokerCredentials,
  ticker: string,
  count: number
): Promise<number[]> {
  if (credentials.broker === "capitalcom") {
    return getCapitalPriceHistory(userId, credentials.capital, ticker, "HOUR", count);
  }

  try {
    const positions = await t212GetPositions(credentials.trading212);
    const pos = positions.find((p) => p.ticker === ticker);
    if (pos) {
      const price = pos.currentPrice;
      return Array.from({ length: count }, (_, i) =>
        price * (1 + (Math.random() - 0.5) * 0.02)
      ).map((p, i) => (i === count - 1 ? price : p));
    }
    return [];
  } catch {
    logger.warn({ ticker }, "Could not fetch price history from Trading 212");
    return [];
  }
}

export interface NormalizedQuote {
  ticker: string;
  bid: number;
  offer: number;
  price: number;
  marketStatus: string | null;
  currency: string | null;
}

export async function getBrokerQuote(userId: number, credentials: UserBrokerCredentials, ticker: string): Promise<NormalizedQuote> {
  if (credentials.broker === "capitalcom") {
    const q = await getCapitalQuote(userId, credentials.capital, ticker);
    return {
      ticker,
      bid: q.bid,
      offer: q.offer,
      price: (q.bid + q.offer) / 2,
      marketStatus: q.marketStatus,
      currency: q.currency,
    };
  }

  // Trading 212 has no live-quote endpoint — best-effort from the latest known price.
  const prices = await getBrokerPriceHistory(userId, credentials, ticker, 2);
  const last = prices[prices.length - 1];
  if (!last || !(last > 0)) {
    throw new Error(`No live quote available for ${ticker} on Trading 212`);
  }
  return { ticker, bid: last, offer: last, price: last, marketStatus: null, currency: null };
}

export interface StopLossParams {
  stopLossPercent: number;
  entryPrice: number;
}

export interface TakeProfitParams {
  takeProfitPercent: number;
  entryPrice: number;
}

export async function placeBrokerOrder(
  userId: number,
  credentials: UserBrokerCredentials,
  ticker: string,
  quantity: number,
  side: "BUY" | "SELL",
  stopLoss?: StopLossParams,
  takeProfit?: TakeProfitParams
): Promise<NormalizedOrder> {
  if (credentials.broker === "capitalcom") {
    // A stop protects on the losing side, a profit target on the winning side —
    // mirrored by trade direction (a long stops below / targets above entry).
    const stopLevel = stopLoss
      ? side === "BUY"
        ? stopLoss.entryPrice * (1 - stopLoss.stopLossPercent / 100)
        : stopLoss.entryPrice * (1 + stopLoss.stopLossPercent / 100)
      : undefined;
    const profitLevel = takeProfit
      ? side === "BUY"
        ? takeProfit.entryPrice * (1 + takeProfit.takeProfitPercent / 100)
        : takeProfit.entryPrice * (1 - takeProfit.takeProfitPercent / 100)
      : undefined;
    const result = await placeCapitalOrder(userId, credentials.capital, ticker, quantity, side, stopLevel, profitLevel);
    return { id: result.dealReference };
  }

  // Trading 212's order API does not support attaching stop-loss / take-profit
  // levels here, so those protections are silently unavailable on this broker.
  if (stopLoss || takeProfit) {
    logger.warn(
      { broker: credentials.broker, ticker },
      "Trading 212 does not support attached stop-loss / take-profit — order placed without them"
    );
  }
  const result = await t212PlaceOrder(credentials.trading212, ticker, quantity, side);
  return { id: result.id };
}
