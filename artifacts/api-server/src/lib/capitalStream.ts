import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { getCapitalSessionTokens } from "./capitalcom";
import type { CapitalCredentials } from "./brokerCredentialsService";
import { db, instrumentsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { logger } from "./logger";

const WSS_URL = "wss://api-streaming-capital.backend-capital.com/connect";
const PING_INTERVAL_MS = 9 * 60 * 1000; // Capital.com session lives 10m; ping under that.
const MAX_EPICS = 40; // Capital.com hard limit per connection.

/** A normalized live quote for one instrument. */
export interface LiveQuote {
  epic: string;
  bid: number;
  offer: number;
  mid: number;
  timestamp: number;
}

interface CapitalQuoteMessage {
  status?: string;
  destination?: string;
  payload?: {
    epic?: string;
    bid?: number;
    ofr?: number;
    timestamp?: number;
    subscriptions?: Record<string, string>;
  };
}

/**
 * Per-user manager for a Capital.com streaming WebSocket connection.
 *
 * One upstream connection per user (shared across that user's own browser
 * tabs via the registry below — see `acquireCapitalStream`/`releaseCapitalStream`).
 * Keeps the latest quote per epic in memory, re-subscribes to that user's
 * enabled instruments, pings to keep the session alive, and reconnects with
 * backoff (re-authenticating) when the socket drops.
 *
 * Emits:
 *   - "quote"  (quote: LiveQuote)      on every price update
 *   - "status" (connected: boolean)    on connect/disconnect
 */
class CapitalStreamManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private starting = false;
  private stopped = true;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private correlationCounter = 0;
  private subscribedEpics = new Set<string>();
  private latest = new Map<string, LiveQuote>();
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly userId: number,
    private readonly credentials: CapitalCredentials,
  ) {
    super();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSnapshot(): LiveQuote[] {
    return Array.from(this.latest.values());
  }

  /** Idempotently start the upstream connection. Safe to call on every client connect. */
  async start(): Promise<void> {
    this.stopped = false;
    if (this.connected || this.starting) return;
    await this.connect(false);
  }

  /** Permanently stop this manager — closes the socket and cancels timers/reconnects. */
  stop(): void {
    this.stopped = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    logger.info({ userId: this.userId }, "Capital.com stream stopped");
  }

  private nextCorrelationId(): string {
    this.correlationCounter += 1;
    return String(this.correlationCounter);
  }

  private async connect(forceRefreshTokens: boolean): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      const { cst, securityToken } = await getCapitalSessionTokens(this.userId, this.credentials, forceRefreshTokens);
      const ws = new WebSocket(WSS_URL);
      this.ws = ws;

      ws.on("open", () => {
        this.connected = true;
        this.starting = false;
        this.reconnectAttempts = 0;
        logger.info({ userId: this.userId }, "Capital.com stream connected");
        this.emit("status", true);
        this.startPing(cst, securityToken);
        // Subscribe to whatever the current enabled set is.
        void this.syncSubscriptions();
      });

      ws.on("message", (raw: WebSocket.RawData) => {
        this.handleMessage(raw.toString());
      });

      ws.on("error", (err: Error) => {
        logger.warn({ userId: this.userId, err: err.message }, "Capital.com stream error");
      });

      ws.on("close", () => {
        this.connected = false;
        this.starting = false;
        this.stopPing();
        this.emit("status", false);
        if (!this.stopped) this.scheduleReconnect();
      });
    } catch (err) {
      this.starting = false;
      logger.warn(
        { userId: this.userId, err: err instanceof Error ? err.message : String(err) },
        "Capital.com stream failed to open",
      );
      if (!this.stopped) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempts, 5));
    logger.info({ userId: this.userId, delay, attempt: this.reconnectAttempts }, "Capital.com stream reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.subscribedEpics.clear();
      // Force fresh tokens after a drop — the old session may have expired.
      void this.connect(true);
    }, delay);
  }

  private startPing(cst: string, securityToken: string): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({
        destination: "ping",
        correlationId: this.nextCorrelationId(),
        cst,
        securityToken,
      });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(text: string): void {
    let msg: CapitalQuoteMessage;
    try {
      msg = JSON.parse(text) as CapitalQuoteMessage;
    } catch {
      return;
    }
    if (msg.destination === "quote" && msg.payload) {
      const { epic, bid, ofr, timestamp } = msg.payload;
      if (typeof epic === "string" && typeof bid === "number" && typeof ofr === "number") {
        const quote: LiveQuote = {
          epic,
          bid,
          offer: ofr,
          mid: (bid + ofr) / 2,
          timestamp: typeof timestamp === "number" ? timestamp : Date.now(),
        };
        this.latest.set(epic, quote);
        this.emit("quote", quote);
      }
      return;
    }

    if (msg.destination === "marketData.subscribe") {
      logger.info({ userId: this.userId, subscriptions: msg.payload?.subscriptions }, "Capital.com stream subscription result");
      return;
    }

    if (msg.status === "ERROR") {
      logger.warn({ userId: this.userId, msg }, "Capital.com stream error message");
    }
  }

  /**
   * Reconcile the upstream subscription with this user's current set of
   * enabled instruments. Subscribes to newly-enabled epics and unsubscribes
   * from removed ones. No-ops when the socket isn't open yet (the "open"
   * handler calls this again once connected).
   */
  async syncSubscriptions(): Promise<void> {
    // Single-flight: overlapping calls (multiple SSE clients connecting at once)
    // would otherwise diff against stale `subscribedEpics` state and emit
    // duplicate/conflicting subscribe/unsubscribe messages. Serialize them.
    if (this.syncing) {
      await this.syncing;
      return;
    }
    this.syncing = this.runSync().finally(() => {
      this.syncing = null;
    });
    await this.syncing;
  }

  private async runSync(): Promise<void> {
    if (!this.connected) return;

    let rows: { ticker: string }[] = [];
    try {
      rows = await db
        .select({ ticker: instrumentsTable.ticker })
        .from(instrumentsTable)
        .where(and(eq(instrumentsTable.userId, this.userId), eq(instrumentsTable.enabled, true)))
        .orderBy(asc(instrumentsTable.id));
    } catch (err) {
      logger.warn(
        { userId: this.userId, err: err instanceof Error ? err.message : String(err) },
        "Capital.com stream could not load instruments",
      );
      return;
    }

    const desired = new Set(rows.map((r) => r.ticker).slice(0, MAX_EPICS));
    const { cst, securityToken } = await getCapitalSessionTokens(this.userId, this.credentials);

    const toAdd = [...desired].filter((e) => !this.subscribedEpics.has(e));
    const toRemove = [...this.subscribedEpics].filter((e) => !desired.has(e));

    if (toAdd.length > 0) {
      this.send({
        destination: "marketData.subscribe",
        correlationId: this.nextCorrelationId(),
        cst,
        securityToken,
        payload: { epics: toAdd },
      });
      toAdd.forEach((e) => this.subscribedEpics.add(e));
    }

    if (toRemove.length > 0) {
      this.send({
        destination: "marketData.unsubscribe",
        correlationId: this.nextCorrelationId(),
        cst,
        securityToken,
        payload: { epics: toRemove },
      });
      toRemove.forEach((e) => {
        this.subscribedEpics.delete(e);
        this.latest.delete(e);
      });
    }
  }
}

export type { CapitalStreamManager };

// ---------------------------------------------------------------------------
// Per-user registry — ref-counted so a manager is created on demand and torn
// down (after a short grace period) once nobody is watching it anymore,
// rather than running forever like the old single-tenant singleton did.
// ---------------------------------------------------------------------------

const IDLE_TEARDOWN_MS = 30_000;

const managers = new Map<number, CapitalStreamManager>();
const refCounts = new Map<number, number>();
const teardownTimers = new Map<number, NodeJS.Timeout>();

/** Call once per SSE client connect. Pair with `releaseCapitalStream` on disconnect. */
export function acquireCapitalStream(userId: number, credentials: CapitalCredentials): CapitalStreamManager {
  const pendingTeardown = teardownTimers.get(userId);
  if (pendingTeardown) {
    clearTimeout(pendingTeardown);
    teardownTimers.delete(userId);
  }

  refCounts.set(userId, (refCounts.get(userId) ?? 0) + 1);

  let manager = managers.get(userId);
  if (!manager) {
    manager = new CapitalStreamManager(userId, credentials);
    managers.set(userId, manager);
  }
  return manager;
}

/** Call once per SSE client disconnect, paired with the `acquireCapitalStream` that opened it. */
export function releaseCapitalStream(userId: number): void {
  const remaining = (refCounts.get(userId) ?? 1) - 1;
  if (remaining > 0) {
    refCounts.set(userId, remaining);
    return;
  }
  refCounts.delete(userId);
  const timer = setTimeout(() => {
    teardownTimers.delete(userId);
    const manager = managers.get(userId);
    if (manager) {
      manager.stop();
      managers.delete(userId);
    }
  }, IDLE_TEARDOWN_MS);
  teardownTimers.set(userId, timer);
}

/**
 * Immediately stop and evict a user's stream manager, bypassing the grace
 * period — used when their broker credentials change or are removed, so a
 * running manager never keeps using stale credentials.
 */
export function evictCapitalStream(userId: number): void {
  const pendingTeardown = teardownTimers.get(userId);
  if (pendingTeardown) {
    clearTimeout(pendingTeardown);
    teardownTimers.delete(userId);
  }
  refCounts.delete(userId);
  const manager = managers.get(userId);
  if (manager) {
    manager.stop();
    managers.delete(userId);
  }
}
