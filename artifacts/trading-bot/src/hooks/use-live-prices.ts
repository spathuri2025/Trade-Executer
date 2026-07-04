import { useEffect, useRef, useState } from "react";

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
 * Subscribes to the server's SSE live-price relay (`/api/stream/prices`), which
 * fans out the shared Capital.com WebSocket feed. Returns the latest quote per
 * epic plus the upstream connection status. EventSource auto-reconnects on drop.
 */
export function useLivePrices(): LivePricesState {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/stream/prices");
    sourceRef.current = es;

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
        setQuotes(map);
        setConnected(data.connected);
      } else if (data.type === "quote") {
        setQuotes((prev) => ({ ...prev, [data.quote.epic]: data.quote }));
      } else if (data.type === "status") {
        setConnected(data.connected);
      }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource retries automatically; nothing else to do here.
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, []);

  return { quotes, connected };
}
