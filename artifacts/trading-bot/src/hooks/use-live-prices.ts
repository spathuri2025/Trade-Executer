import { useSyncExternalStore } from "react";

export interface LiveQuote {
  epic: string;
  bid: number;
  offer: number;
  mid: number;
  timestamp: number;
}

interface SnapshotEvent {
  type: "snapshot";
  quotes: LiveQuote[];
  connected: boolean;
}
interface QuoteEvent {
  type: "quote";
  quote: LiveQuote;
}
interface StatusEvent {
  type: "status";
  connected: boolean;
}
type StreamEvent = SnapshotEvent | QuoteEvent | StatusEvent;

export interface LivePricesState {
  /** Latest quote per epic. */
  quotes: Record<string, LiveQuote>;
  /** Whether the upstream Capital.com stream is currently connected. */
  connected: boolean;
}

/**
 * Shared, module-level SSE store for the server's live-price relay
 * (`/api/stream/prices`). A single EventSource is opened for the whole app and
 * ref-counted by subscribers, so mounting many price consumers never opens more
 * than one upstream connection.
 *
 * Crucially, `quotes[epic]` keeps a stable object reference for any epic that
 * did not change on a given tick. That lets `useLiveQuote(epic)` (via
 * `useSyncExternalStore`) re-render a component ONLY when its own epic ticks,
 * instead of on every tick from every subscribed instrument — the difference
 * between a chart that updates smoothly and one that feels laggy when dozens of
 * instruments are streaming.
 */
let source: EventSource | null = null;
let refCount = 0;
let quotes: Record<string, LiveQuote> = {};
let connected = false;
let snapshot: LivePricesState = { quotes, connected };
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { quotes, connected };
  for (const l of listeners) l();
}

function openConnection(): void {
  if (source) return;
  const es = new EventSource("/api/stream/prices");
  source = es;

  es.onmessage = (e) => {
    let data: StreamEvent;
    try {
      data = JSON.parse(e.data) as StreamEvent;
    } catch {
      return;
    }
    if (data.type === "snapshot") {
      const map: Record<string, LiveQuote> = {};
      for (const q of data.quotes) map[q.epic] = q;
      quotes = map;
      connected = data.connected;
      emit();
    } else if (data.type === "quote") {
      // New top-level object (so consumers of `quotes` see a change) but every
      // other epic keeps its previous object reference.
      quotes = { ...quotes, [data.quote.epic]: data.quote };
      emit();
    } else if (data.type === "status") {
      if (connected !== data.connected) {
        connected = data.connected;
        emit();
      }
    }
  };

  es.onerror = () => {
    // EventSource retries automatically; just reflect the dropped state once.
    if (connected) {
      connected = false;
      emit();
    }
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  refCount += 1;
  openConnection();
  return () => {
    listeners.delete(listener);
    refCount -= 1;
    if (refCount === 0 && source) {
      source.close();
      source = null;
      connected = false;
      snapshot = { quotes, connected };
    }
  };
}

/**
 * Subscribe to the full live-quote map plus connection status. Re-renders on
 * every tick — use this only where you genuinely need all instruments (e.g. the
 * dashboard ticker strip). For a single instrument, prefer `useLiveQuote`.
 */
export function useLivePrices(): LivePricesState {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

export interface LiveQuoteState {
  quote: LiveQuote | undefined;
  connected: boolean;
}

/**
 * Subscribe to a single instrument's latest quote. Re-renders only when that
 * epic ticks (or the connection status flips), not on unrelated instruments.
 */
export function useLiveQuote(epic: string | undefined): LiveQuoteState {
  const quote = useSyncExternalStore(
    subscribe,
    () => (epic ? quotes[epic] : undefined),
    () => undefined,
  );
  const isConnected = useSyncExternalStore(
    subscribe,
    () => connected,
    () => false,
  );
  return { quote, connected: isConnected };
}
