import { useListTrades, getListTradesQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

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

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "FILLED" ? "text-primary border-primary bg-primary/10" :
    status === "FAILED" ? "text-destructive border-destructive bg-destructive/10" :
    "text-amber-500 border-amber-500 bg-amber-500/10";
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}

export default function Trades() {
  const { data: trades, isLoading } = useListTrades(undefined, {
    query: { queryKey: getListTradesQueryKey() }
  });

  return (
    <div className="space-y-6 md:space-y-8">
      <h1 className="text-2xl md:text-4xl font-light tracking-tight">Trade History</h1>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : !trades || trades.length === 0 ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          No trades found.
        </div>
      ) : (
        <>
          {/* ── Mobile card list (hidden on md+) ── */}
          <div className="md:hidden space-y-3">
            {trades.map((trade) => {
              const buy = trade.side === "BUY";
              return (
                <div key={trade.id} className="p-4 rounded-lg" style={{ backgroundColor: card, border: cardBorder }}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-semibold text-sm">{trade.ticker}</div>
                      <div className="text-xs mt-0.5" style={{ color: muted }}>
                        {new Date(trade.executedAt).toLocaleString()}
                      </div>
                    </div>
                    <StatusBadge status={trade.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-3 pt-3" style={{ borderTop: divider }}>
                    <div>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Side</div>
                      <div className={`text-sm font-semibold font-mono mt-0.5 ${buy ? "text-primary" : "text-destructive"}`}>
                        {trade.side}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Qty</div>
                      <div className="text-sm font-mono mt-0.5">{trade.quantity}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Price</div>
                      <div className="text-sm font-mono mt-0.5">{trade.price.toFixed(2)}</div>
                    </div>
                  </div>
                  {trade.total != null && (
                    <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: divider }}>
                      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Total</span>
                      <span className="text-sm font-mono font-medium">{trade.total.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Desktop table (hidden on mobile) ── */}
          <div className="hidden md:block rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr style={{ borderBottom: divider }}>
                    {["Time", "Ticker", "Side", "Qty", "Price", "Total", "Status"].map((h) => (
                      <th key={h} className="px-5 py-4">
                        <SectionLabel>{h}</SectionLabel>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {trades.map((trade, idx) => (
                    <tr
                      key={trade.id}
                      style={idx < trades.length - 1 ? { borderBottom: divider } : {}}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "hsl(var(--accent))")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                    >
                      <td className="px-5 py-4 whitespace-nowrap text-xs" style={{ color: muted }}>
                        {new Date(trade.executedAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 font-bold">{trade.ticker}</td>
                      <td className={`px-5 py-4 font-semibold ${trade.side === "BUY" ? "text-primary" : "text-destructive"}`}>
                        {trade.side}
                      </td>
                      <td className="px-5 py-4">{trade.quantity}</td>
                      <td className="px-5 py-4">{trade.price.toFixed(2)}</td>
                      <td className="px-5 py-4">{trade.total ? trade.total.toFixed(2) : "—"}</td>
                      <td className="px-5 py-4"><StatusBadge status={trade.status} /></td>
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
