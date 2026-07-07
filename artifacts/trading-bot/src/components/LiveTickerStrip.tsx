import { useEffect, useRef, useState } from "react";
import { useListInstruments, getListInstrumentsQueryKey } from "@workspace/api-client-react";
import { useLivePrices, type LiveQuote } from "@/hooks/use-live-prices";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const muted = "hsl(var(--muted-foreground))";
const emerald = "#10b981";
const red = "#f87171";

function formatPrice(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 3 : 5;
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * One ticker tile. Tracks the previous mid price so it can flash green/red on
 * every update and show a small directional arrow — the "live" feel.
 */
function TickerTile({ ticker, name, quote }: { ticker: string; name: string; quote: LiveQuote | undefined }) {
  const prevMid = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (!quote) return undefined;
    const prev = prevMid.current;
    if (prev !== null && quote.mid !== prev) {
      setFlash(quote.mid > prev ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 600);
      prevMid.current = quote.mid;
      return () => clearTimeout(t);
    }
    prevMid.current = quote.mid;
    return undefined;
  }, [quote]);

  const flashColor = flash === "up" ? emerald : flash === "down" ? red : "transparent";
  const hasData = !!quote;

  return (
    <div
      className="shrink-0 rounded-lg px-4 py-3 transition-colors"
      style={{
        minWidth: 148,
        backgroundColor: card,
        border: cardBorder,
        boxShadow: flash ? `inset 0 0 0 1px ${flashColor}` : "none",
      }}
      data-testid={`ticker-${ticker}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold tracking-wide">{ticker}</span>
        {hasData ? (
          <span
            className="text-[10px]"
            style={{ color: flash === "down" ? red : emerald }}
          >
            {flash === "down" ? "▼" : "▲"}
          </span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: muted }} title="Waiting for data" />
        )}
      </div>
      <div
        className="mt-1 font-mono text-lg tabular-nums transition-colors"
        style={{ color: flash ? flashColor : "hsl(var(--foreground))" }}
      >
        {hasData ? formatPrice(quote!.mid) : "—"}
      </div>
      <div className="mt-0.5 truncate text-[10px]" style={{ color: muted }} title={name}>
        {hasData ? `bid ${formatPrice(quote!.bid)} · ask ${formatPrice(quote!.offer)}` : name}
      </div>
    </div>
  );
}

/**
 * Horizontal strip of live price tiles for every enabled instrument, fed by
 * this user's own Capital.com streaming WebSocket via SSE. Prices update in
 * real time (markets permitting — closed markets simply show the last value
 * / "waiting").
 */
export default function LiveTickerStrip() {
  const { data: instruments } = useListInstruments({
    query: { queryKey: getListInstrumentsQueryKey() },
  });
  const { quotes, connected } = useLivePrices();

  const enabled = (instruments ?? []).filter((i) => i.enabled);
  if (enabled.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: connected ? emerald : muted,
            boxShadow: connected ? "0 0 8px rgba(16,185,129,0.5)" : "none",
          }}
        />
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
          Live Prices {connected ? "· Live" : "· Connecting…"}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {enabled.map((inst) => (
          <TickerTile key={inst.id} ticker={inst.ticker} name={inst.name} quote={quotes[inst.ticker]} />
        ))}
      </div>
    </div>
  );
}
