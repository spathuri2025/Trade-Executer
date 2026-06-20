import { useState, useEffect } from "react";
import {
  useListSignals,
  getListSignalsQueryKey,
  useGetBotStatus,
  getGetBotStatusQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  const cls =
    signal === "BUY"  ? "text-primary border-primary bg-primary/10" :
    signal === "SELL" ? "text-destructive border-destructive bg-destructive/10" :
    "text-amber-500 border-amber-500 bg-amber-500/10";
  return <Badge variant="outline" className={cls}>{signal}</Badge>;
}

function useCountdown(dataUpdatedAt: number, intervalMs: number) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    if (!dataUpdatedAt || !intervalMs) return;
    const tick = () => {
      const nextAt = dataUpdatedAt + intervalMs;
      const diff = Math.max(0, nextAt - Date.now());
      const m = Math.floor(diff / 60_000);
      const s = Math.floor((diff % 60_000) / 1000);
      setRemaining(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dataUpdatedAt, intervalMs]);
  return remaining;
}

export default function Signals() {
  /* Bot status drives the refresh interval */
  const { data: botStatus } = useGetBotStatus(undefined, {
    query: {
      queryKey: getGetBotStatusQueryKey(),
      refetchInterval: 30_000,
    },
  });

  const botIntervalMs = (botStatus?.config?.intervalMinutes ?? 15) * 60_000;

  const { data: signals, isLoading, dataUpdatedAt } = useListSignals(undefined, {
    query: {
      queryKey: getListSignalsQueryKey(),
      refetchInterval: botIntervalMs,
    },
  });

  const countdown = useCountdown(dataUpdatedAt, botIntervalMs);

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <h1 className="text-2xl md:text-4xl font-light tracking-tight">Signal Log</h1>
        <div className="flex items-center gap-2 mb-0.5">
          {botStatus?.config && (
            <span className="text-xs" style={{ color: muted }}>
              Interval: {botStatus.config.intervalMinutes} min
            </span>
          )}
          {countdown && (
            <span className="text-xs tabular-nums" style={{ color: muted }}>
              · next in {countdown}
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : !signals || signals.length === 0 ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          No signals generated yet.
        </div>
      ) : (
        <>
          {/* ── Mobile card list ── */}
          <div className="md:hidden space-y-3">
            {signals.map((sig) => (
              <div key={sig.id} className="p-4 rounded-lg" style={{ backgroundColor: card, border: cardBorder }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold text-sm">{sig.ticker}</div>
                    <div className="text-xs mt-0.5" style={{ color: muted }}>
                      {new Date(sig.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <SignalBadge signal={sig.signal} />
                </div>
                <div className="grid grid-cols-3 gap-3 pt-3" style={{ borderTop: divider }}>
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Price</div>
                    <div className="text-sm font-mono mt-0.5">{sig.price.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Short MA</div>
                    <div className="text-sm font-mono mt-0.5">{sig.shortMa.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Long MA</div>
                    <div className="text-sm font-mono mt-0.5">{sig.longMa.toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: divider }}>
                  <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Trade Executed</span>
                  {sig.tradeExecuted
                    ? <Check className="h-4 w-4 text-primary" />
                    : <X className="h-4 w-4" style={{ color: muted }} />
                  }
                </div>
              </div>
            ))}
          </div>

          {/* ── Desktop table ── */}
          <div className="hidden md:block rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr style={{ borderBottom: divider }}>
                    {["Time", "Ticker", "Signal", "Price", "Short MA", "Long MA", "Executed"].map((h) => (
                      <th key={h} className="px-5 py-4">
                        <SectionLabel>{h}</SectionLabel>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {signals.map((sig, idx) => (
                    <tr
                      key={sig.id}
                      style={idx < signals.length - 1 ? { borderBottom: divider } : {}}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "hsl(var(--accent))")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                    >
                      <td className="px-5 py-4 whitespace-nowrap text-xs" style={{ color: muted }}>
                        {new Date(sig.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 font-bold">{sig.ticker}</td>
                      <td className="px-5 py-4"><SignalBadge signal={sig.signal} /></td>
                      <td className="px-5 py-4">{sig.price.toFixed(2)}</td>
                      <td className="px-5 py-4">{sig.shortMa.toFixed(2)}</td>
                      <td className="px-5 py-4">{sig.longMa.toFixed(2)}</td>
                      <td className="px-5 py-4">
                        {sig.tradeExecuted
                          ? <Check className="h-4 w-4 text-primary" />
                          : <X className="h-4 w-4" style={{ color: muted }} />
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
