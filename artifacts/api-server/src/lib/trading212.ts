import { logger } from "./logger";

const BASE_URL = "https://live.trading212.com/api/v0";

function getApiKey(): string {
  const key = process.env.TRADING212_API_KEY;
  if (!key) throw new Error("TRADING212_API_KEY is not set");
  return key;
}

async function t212Fetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: getApiKey(),
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn({ status: res.status, url, body: text }, "Trading 212 API error");
    throw new Error(`Trading 212 API ${res.status}: ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return null;
}

export interface T212Position {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  ppl: number;
  fxPpl?: number;
  initialFillDate?: string;
  frontend?: string;
  maxBuy?: number;
  maxSell?: number;
  pieQuantity?: number;
}

export interface T212Account {
  id: number;
  currencyCode: string;
}

export interface T212AccountCash {
  free: number;
  invested: number;
  result: number;
  total: number;
  pieCash: number;
  blocked: number;
  ppl?: number;
}

export interface T212Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date: string;
}

export interface T212OrderResponse {
  id: string;
  type: string;
  status: string;
  filledQuantity?: number;
  filledPrice?: number;
}

export async function getPositions(): Promise<T212Position[]> {
  const data = await t212Fetch("/equity/portfolio");
  return (data as T212Position[]) ?? [];
}

export async function getAccountInfo(): Promise<T212Account> {
  return t212Fetch("/equity/account/info") as Promise<T212Account>;
}

export async function getAccountCash(): Promise<T212AccountCash> {
  return t212Fetch("/equity/account/cash") as Promise<T212AccountCash>;
}

export async function getCandles(
  ticker: string,
  resolution: string = "HOUR",
  limit: number = 50
): Promise<T212Candle[]> {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - limit * 3600 * 1000).toISOString();
  const data = await t212Fetch(
    `/equity/history/orders?ticker=${encodeURIComponent(ticker)}&limit=${limit}`
  ).catch(() => null);

  if (!data) return [];

  const candles = await t212Fetch(
    `/equity/history/orders?ticker=${encodeURIComponent(ticker)}&limit=${limit}&from=${from}&to=${to}`
  ).catch(() => null);

  return (candles as T212Candle[]) ?? [];
}

export async function getPriceHistory(ticker: string, count: number = 50): Promise<number[]> {
  try {
    const url = `/equity/history/orders?ticker=${encodeURIComponent(ticker)}&limit=${count}`;
    const data = (await t212Fetch(url)) as { items?: Array<{ filledPrice?: number; limitPrice?: number }> } | null;
    const items = data?.items ?? [];
    return items
      .filter((o) => o.filledPrice != null || o.limitPrice != null)
      .map((o) => o.filledPrice ?? o.limitPrice ?? 0)
      .filter((p) => p > 0);
  } catch {
    logger.warn({ ticker }, "Could not fetch price history from Trading 212");
    return [];
  }
}

export async function placeMarketOrder(
  ticker: string,
  quantity: number,
  side: "BUY" | "SELL"
): Promise<T212OrderResponse> {
  const body = side === "BUY"
    ? { ticker, quantity }
    : { ticker, quantity };

  const endpoint = side === "BUY"
    ? "/equity/orders/market"
    : "/equity/orders/market";

  return t212Fetch(endpoint, {
    method: "POST",
    body: JSON.stringify({ ticker, quantity }),
  }) as Promise<T212OrderResponse>;
}

export async function getCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const positions = await getPositions();
    const pos = positions.find((p) => p.ticker === ticker);
    if (pos) return pos.currentPrice;
    return null;
  } catch {
    return null;
  }
}
