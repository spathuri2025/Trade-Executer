import { logger } from "./logger";
import type { CapitalCredentials } from "./brokerCredentialsService";

const LIVE_BASE = "https://api-capital.backend-capital.com/api/v1";
const BASE_URL = LIVE_BASE;

interface Session {
  cst: string;
  securityToken: string;
  expiresAt: number;
}

interface SessionCacheEntry {
  cachedSession: Session | null;
  sessionCooldownUntil: number;
  sessionInFlight: Promise<Session> | null;
}

/** One session-cache entry per user — each customer has their own Capital.com login. */
const sessionCacheByUser = new Map<number, SessionCacheEntry>();

function getCacheEntry(userId: number): SessionCacheEntry {
  let entry = sessionCacheByUser.get(userId);
  if (!entry) {
    entry = { cachedSession: null, sessionCooldownUntil: 0, sessionInFlight: null };
    sessionCacheByUser.set(userId, entry);
  }
  return entry;
}

async function createSession(userId: number, credentials: CapitalCredentials): Promise<Session> {
  const entry = getCacheEntry(userId);
  const { apiKey, identifier, password } = credentials;

  const res = await fetch(`${BASE_URL}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CAP-API-KEY": apiKey,
    },
    body: JSON.stringify({
      identifier,
      password,
      encryptedPassword: false,
    }),
  });

  if (res.status === 429) {
    entry.sessionCooldownUntil = Date.now() + 60_000;
    throw new Error("Capital.com rate limit hit — session creation paused for 60s");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Capital.com session error ${res.status}: ${text}`);
  }

  const cst = res.headers.get("CST") ?? "";
  const securityToken = res.headers.get("X-SECURITY-TOKEN") ?? "";

  if (!cst || !securityToken) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const bodyStr = JSON.stringify(body);
    throw new Error(`Capital.com did not return session tokens. Body: ${bodyStr}`);
  }

  const session: Session = {
    cst,
    securityToken,
    expiresAt: Date.now() + 9 * 60 * 1000,
  };

  entry.cachedSession = session;
  entry.sessionCooldownUntil = 0;
  logger.info({ userId }, "Capital.com session created");
  return session;
}

async function getSession(userId: number, credentials: CapitalCredentials): Promise<Session> {
  const entry = getCacheEntry(userId);
  const validSession = entry.cachedSession && entry.cachedSession.expiresAt > Date.now() + 30_000;
  if (validSession) return entry.cachedSession!;

  if (Date.now() < entry.sessionCooldownUntil) {
    if (entry.cachedSession) {
      logger.warn({ userId }, "Capital.com rate-limit cooldown active — reusing stale session");
      return entry.cachedSession;
    }
    throw new Error(`Capital.com rate-limit cooldown active. Retry after ${Math.ceil((entry.sessionCooldownUntil - Date.now()) / 1000)}s`);
  }

  if (entry.sessionInFlight) return entry.sessionInFlight;

  entry.sessionInFlight = createSession(userId, credentials).finally(() => { entry.sessionInFlight = null; });
  return entry.sessionInFlight;
}

export async function capitalAuthFetch(userId: number, credentials: CapitalCredentials, path: string, options: RequestInit = {}): Promise<unknown> {
  return capitalFetch(userId, credentials, path, options);
}

/**
 * Returns valid Capital.com session tokens (CST + X-SECURITY-TOKEN) for use
 * with the streaming WebSocket. Reuses the same cached session as the REST
 * client, and forces a fresh session when `forceRefresh` is set (e.g. after a
 * streaming reconnect where the old tokens may have expired).
 */
export async function getCapitalSessionTokens(
  userId: number,
  credentials: CapitalCredentials,
  forceRefresh = false,
): Promise<{ cst: string; securityToken: string }> {
  if (forceRefresh) {
    getCacheEntry(userId).cachedSession = null;
  }
  const session = await getSession(userId, credentials);
  return { cst: session.cst, securityToken: session.securityToken };
}

async function capitalFetch(userId: number, credentials: CapitalCredentials, path: string, options: RequestInit = {}): Promise<unknown> {
  const entry = getCacheEntry(userId);
  const session = await getSession(userId, credentials);
  const url = `${BASE_URL}${path}`;

  const makeRequest = async (s: Session) =>
    fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        CST: s.cst,
        "X-SECURITY-TOKEN": s.securityToken,
        ...(options.headers ?? {}),
      },
    });

  let res = await makeRequest(session);

  if (res.status === 401) {
    entry.cachedSession = null;
    if (Date.now() < entry.sessionCooldownUntil) {
      throw new Error("Capital.com session expired and rate-limit cooldown active");
    }
    const freshSession = await createSession(userId, credentials);
    res = await makeRequest(freshSession);
  }

  if (res.status === 429) {
    entry.sessionCooldownUntil = Date.now() + 60_000;
    throw new Error("Capital.com rate limit hit on request");
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

export async function getCapitalPositions(userId: number, credentials: CapitalCredentials): Promise<CapitalPosition[]> {
  const data = await capitalFetch(userId, credentials, "/positions") as { positions: CapitalPosition[] };
  return data?.positions ?? [];
}

export async function getCapitalAccounts(userId: number, credentials: CapitalCredentials): Promise<CapitalAccount> {
  return capitalFetch(userId, credentials, "/accounts") as Promise<CapitalAccount>;
}

export async function getCapitalPriceHistory(
  userId: number,
  credentials: CapitalCredentials,
  epic: string,
  resolution: string = "HOUR",
  count: number = 50,
): Promise<number[]> {
  try {
    const data = await capitalFetch(
      userId,
      credentials,
      `/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=${count}`
    ) as CapitalPrice;
    return (data?.prices ?? []).map((p) => (p.closePrice.bid + p.closePrice.ask) / 2);
  } catch {
    logger.warn({ epic }, "Could not fetch price history from Capital.com");
    return [];
  }
}

/** One OHLC candle with a UNIX-seconds open time (mid of bid/ask for each field). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Fetch OHLC candles for an epic from Capital.com. Each price field is the mid
 * of its bid/ask, matching how `getCapitalPriceHistory` derives its mid closes.
 * Times are converted to UNIX seconds (what lightweight-charts expects).
 */
export async function getCapitalCandles(
  userId: number,
  credentials: CapitalCredentials,
  epic: string,
  resolution: string = "HOUR",
  count: number = 200,
): Promise<Candle[]> {
  const data = (await capitalFetch(
    userId,
    credentials,
    `/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=${count}`,
  )) as CapitalPrice;
  const mid = (p: { bid: number; ask: number }) => (p.bid + p.ask) / 2;
  return (data?.prices ?? [])
    .map((p) => {
      // snapshotTime has no timezone suffix but is UTC; append Z so Date parses it as UTC.
      const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(p.snapshotTime) ? p.snapshotTime : `${p.snapshotTime}Z`;
      return {
        time: Math.floor(new Date(iso).getTime() / 1000),
        open: mid(p.openPrice),
        high: mid(p.highPrice),
        low: mid(p.lowPrice),
        close: mid(p.closePrice),
      };
    })
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    )
    .sort((a, b) => a.time - b.time);
}

export async function placeCapitalOrder(
  userId: number,
  credentials: CapitalCredentials,
  epic: string,
  size: number,
  direction: "BUY" | "SELL",
  stopLevel?: number,
  profitLevel?: number
): Promise<{ dealReference: string }> {
  const body: Record<string, unknown> = {
    epic,
    direction,
    size,
    guaranteedStop: false,
    trailingStop: false,
  };

  if (stopLevel !== undefined) {
    body.stopLevel = Number(stopLevel.toFixed(5));
  }

  if (profitLevel !== undefined) {
    body.profitLevel = Number(profitLevel.toFixed(5));
  }

  const data = await capitalFetch(userId, credentials, "/positions", {
    method: "POST",
    body: JSON.stringify(body),
  }) as { dealReference: string };
  return data;
}

export interface CapitalQuote {
  epic: string;
  bid: number;
  offer: number;
  marketStatus: string;
  currency: string | null;
  updateTime: string | null;
}

export async function getCapitalQuote(userId: number, credentials: CapitalCredentials, epic: string): Promise<CapitalQuote> {
  const data = await capitalFetch(userId, credentials, `/markets/${encodeURIComponent(epic)}`) as {
    instrument?: { currency?: string };
    snapshot?: { bid?: number; offer?: number; marketStatus?: string; updateTime?: string };
  };
  const snap = data?.snapshot;
  if (!snap || typeof snap.bid !== "number" || typeof snap.offer !== "number") {
    throw new Error(`No live quote available for ${epic}`);
  }
  return {
    epic,
    bid: snap.bid,
    offer: snap.offer,
    marketStatus: snap.marketStatus ?? "UNKNOWN",
    currency: data.instrument?.currency ?? null,
    updateTime: snap.updateTime ?? null,
  };
}
