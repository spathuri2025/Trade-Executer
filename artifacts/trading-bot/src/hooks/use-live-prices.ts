import { useQueries, useQuery } from "@tanstack/react-query";
import { getGetQuoteQueryOptions, type Quote } from "@workspace/api-client-react";

/**
 * Matches the safe polling cadence documented in
 * .agents/memory/live-data-refresh-cadence.md — brokers rate-limit REST calls,
 * so this stays well above 1s even though it's now a per-user request (each
 * customer has their own broker credentials as of the multi-tenant round —
 * see .agents/memory/session-auth.md).
 */
const POLL_INTERVAL_MS = 20_000;

export interface LiveQuote {
  epic: string;
  bid: number;
  offer: number;
  mid: number;
  timestamp: number;
}

export interface LivePricesState {
  /** Latest quote per ticker. */
  quotes: Record<string, LiveQuote>;
  /** Whether at least one quote has come back successfully. */
  connected: boolean;
}

export interface LiveQuoteState {
  quote: LiveQuote | undefined;
  connected: boolean;
}

function toLiveQuote(ticker: string, q: Quote): LiveQuote {
  return { epic: ticker, bid: q.bid, offer: q.offer, mid: q.price, timestamp: Date.now() };
}

/**
 * Base query options for one ticker's quote, with polling overrides applied
 * by spreading rather than passing through getGetQuoteQueryOptions's generic
 * `options.query` parameter — the latter's TData/TError generics don't infer
 * cleanly for a literal `{ refetchInterval, staleTime, retry }` object there.
 */
function quoteQueryOptions(ticker: string) {
  return {
    ...getGetQuoteQueryOptions({ ticker }),
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS,
    retry: false as const,
  };
}

/**
 * Polls `GET /quote` per ticker on a safe cadence — replaces the old shared
 * Capital.com WebSocket/SSE relay (see .agents/memory/live-price-store.md),
 * which depended on a single global broker connection that no longer exists
 * now that broker credentials are per-user. True per-user WebSocket streaming
 * is deferred to a later round; this is the interim fallback.
 *
 * Each ticker is its own React Query subscription, so — same as the old
 * store's design goal — a tick on one instrument does not re-render consumers
 * of a different instrument (see `useLiveQuote` below).
 */
export function useLivePrices(tickers: string[]): LivePricesState {
  const results = useQueries({
    queries: tickers.map((ticker) => quoteQueryOptions(ticker)),
  });

  const quotes: Record<string, LiveQuote> = {};
  let connected = false;
  results.forEach((r, i) => {
    const ticker = tickers[i];
    if (r.data) {
      quotes[ticker] = toLiveQuote(ticker, r.data);
      connected = true;
    }
  });

  return { quotes, connected };
}

/**
 * Subscribe to a single instrument's latest quote, polled independently of
 * every other instrument (see `useLivePrices`'s doc comment on why this
 * matters for chart responsiveness).
 */
export function useLiveQuote(epic: string | undefined): LiveQuoteState {
  const query = useQuery({
    ...quoteQueryOptions(epic ?? ""),
    enabled: !!epic,
  });

  return {
    quote: epic && query.data ? toLiveQuote(epic, query.data) : undefined,
    connected: !!query.data,
  };
}
