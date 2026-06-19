import { logger } from "./logger";

const LIVE_BASE = "https://api-capital.backend-capital.com/api/v1";
const DEMO_BASE = "https://demo-api-capital.backend-capital.com/api/v1";

const BASE_URL = LIVE_BASE;

interface Session {
  cst: string;
  securityToken: string;
  expiresAt: number;
}

let cachedSession: Session | null = null;

async function createSession(): Promise<Session> {
  const apiKey = process.env.CAPITALCOM_API_KEY;
  const password = process.env.CAPITALCOM_PASSWORD;

  if (!apiKey || !password) {
    throw new Error("CAPITALCOM_API_KEY and CAPITALCOM_PASSWORD must be set");
  }

  const res = await fetch(`${BASE_URL}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CAP-API-KEY": apiKey,
    },
    body: JSON.stringify({
      identifier: apiKey,
      password,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Capital.com session error ${res.status}: ${text}`);
  }

  const cst = res.headers.get("CST") ?? "";
  const securityToken = res.headers.get("X-SECURITY-TOKEN") ?? "";

  if (!cst || !securityToken) {
    throw new Error("Capital.com did not return session tokens");
  }

  const session: Session = {
    cst,
    securityToken,
    expiresAt: Date.now() + 9 * 60 * 1000,
  };

  cachedSession = session;
  logger.info("Capital.com session created");
  return session;
}

async function getSession(): Promise<Session> {
  if (cachedSession && cachedSession.expiresAt > Date.now() + 30_000) {
    return cachedSession;
  }
  return createSession();
}

async function capitalFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const session = await getSession();
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      CST: session.cst,
      "X-SECURITY-TOKEN": session.securityToken,
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) {
    cachedSession = null;
    const freshSession = await createSession();
    const retry = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        CST: freshSession.cst,
        "X-SECURITY-TOKEN": freshSession.securityToken,
        ...(options.headers ?? {}),
      },
    });
    if (!retry.ok) {
      const text = await retry.text().catch(() => "");
      throw new Error(`Capital.com API ${retry.status}: ${text}`);
    }
    return retry.json();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn({ status: res.status, url, body: text }, "Capital.com API error");
    throw new Error(`Capital.com API ${res.status}: ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return null;
}

export interface CapitalPosition {
  position: {
    contractSize: number;
    createdDate: string;
    dealId: string;
    dealReference: string;
    size: number;
    direction: "BUY" | "SELL";
    limitLevel: number | null;
    level: number;
    currency: string;
    controlledRisk: boolean;
    stopLevel: number | null;
    trailingStep: number | null;
    trailingStopDistance: number | null;
    limitedRiskPremium: number | null;
  };
  market: {
    instrumentName: string;
    expiry: string;
    epic: string;
    instrumentType: string;
    lotSize: number;
    high: number;
    low: number;
    percentageChange: number;
    netChange: number;
    bid: number;
    offer: number;
    updateTime: string;
    updateTimeUTC: string;
    delayTime: number;
    streamingPricesAvailable: boolean;
    marketStatus: string;
    scalingFactor: number;
  };
}

export interface CapitalAccount {
  accounts: Array<{
    accountId: string;
    accountName: string;
    preferred: boolean;
    status: string;
    accountType: string;
    currency: string;
    balance: {
      balance: number;
      deposit: number;
      profitLoss: number;
      available: number;
    };
    dealingEnabled: boolean;
    hasActiveDemoAccounts: boolean;
    clientId: string;
  }>;
}

export interface CapitalPrice {
  prices: Array<{
    snapshotTime: string;
    openPrice: { bid: number; ask: number };
    closePrice: { bid: number; ask: number };
    highPrice: { bid: number; ask: number };
    lowPrice: { bid: number; ask: number };
    lastTradedVolume: number;
  }>;
  instrumentType: string;
}

export async function getCapitalPositions(): Promise<CapitalPosition[]> {
  const data = await capitalFetch("/positions") as { positions: CapitalPosition[] };
  return data?.positions ?? [];
}

export async function getCapitalAccounts(): Promise<CapitalAccount> {
  return capitalFetch("/accounts") as Promise<CapitalAccount>;
}

export async function getCapitalPriceHistory(epic: string, resolution: string = "HOUR", count: number = 50): Promise<number[]> {
  try {
    const data = await capitalFetch(
      `/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=${count}`
    ) as CapitalPrice;
    return (data?.prices ?? []).map((p) => (p.closePrice.bid + p.closePrice.ask) / 2);
  } catch {
    logger.warn({ epic }, "Could not fetch price history from Capital.com");
    return [];
  }
}

export async function placeCapitalOrder(
  epic: string,
  size: number,
  direction: "BUY" | "SELL"
): Promise<{ dealReference: string }> {
  const data = await capitalFetch("/positions", {
    method: "POST",
    body: JSON.stringify({
      epic,
      direction,
      size,
      guaranteedStop: false,
      trailingStop: false,
    }),
  }) as { dealReference: string };
  return data;
}
