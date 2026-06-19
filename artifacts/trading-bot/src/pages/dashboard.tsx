import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBotStatus,
  getGetBotStatusQueryKey,
  useGetAccount,
  getGetAccountQueryKey,
  useListPositions,
  getListPositionsQueryKey,
  useListSignals,
  getListSignalsQueryKey,
  useGetMarketNews,
  getGetMarketNewsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="pl-1"
      style={{
        fontSize: "10px",
        textTransform: "uppercase",
        letterSpacing: "0.15em",
        fontWeight: 600,
        color: "rgba(255,255,255,0.4)",
      }}
    >
      {children}
    </p>
  );
}

function TickerAvatar({ ticker }: { ticker: string }) {
  const abbr = ticker.replace("_", "").slice(0, 3).toUpperCase();
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
      style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)" }}
    >
      {abbr}
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPositionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey({ limit: 5 }) });
    }, 180000);
    const newsInterval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetMarketNewsQueryKey() });
    }, 15 * 60 * 1000);
    return () => { clearInterval(interval); clearInterval(newsInterval); };
  }, [queryClient]);

  const { data: botStatus, isLoading: botLoading } = useGetBotStatus(undefined, {
    query: { queryKey: getGetBotStatusQueryKey() },
  });
  const { data: account, isLoading: accountLoading } = useGetAccount(undefined, {
    query: { queryKey: getGetAccountQueryKey() },
  });
  const { data: positions, isLoading: positionsLoading } = useListPositions(undefined, {
    query: { queryKey: getListPositionsQueryKey() },
  });
  const { data: signals, isLoading: signalsLoading } = useListSignals({ limit: 5 }, {
    query: { queryKey: getListSignalsQueryKey({ limit: 5 }) },
  });
  const { data: news, isLoading: newsLoading, isFetching: newsFetching } = useGetMarketNews({ limit: 8 }, {
    query: { queryKey: getGetMarketNewsQueryKey(), staleTime: 15 * 60 * 1000 },
  });

  const refreshNews = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetMarketNewsQueryKey() });
  }, [queryClient]);

  const pnl = account?.result ?? 0;
  const pnlPositive = pnl >= 0;

  return (
    <div className="space-y-12">
      {/* Header */}
      <header className="flex items-end justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-4xl font-light tracking-tight">Dashboard</h1>
          {!botLoading && (
            <div
              className="px-2 py-0.5 rounded mb-1"
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                fontWeight: 700,
                border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              {botStatus?.running ? "Live" : "Bot Stopped"}
              {botStatus?.config.dryRun ? " · Dry Run" : ""}
            </div>
          )}
        </div>
        <div className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.4)" }}>
          Last updated: Just now
        </div>
      </header>

      {/* Stats Row */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Account Value */}
        <div
          className="p-6 rounded-lg flex flex-col gap-4"
          style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <SectionLabel>Account Value</SectionLabel>
          {accountLoading ? (
            <Skeleton className="h-9 w-36" />
          ) : (
            <div className="text-3xl tabular-nums font-medium">
              {account?.total.toFixed(2)} {account?.currency || "GBP"}
            </div>
          )}
        </div>

        {/* Invested */}
        <div
          className="p-6 rounded-lg flex flex-col gap-4"
          style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <SectionLabel>Invested</SectionLabel>
          {accountLoading ? (
            <Skeleton className="h-9 w-36" />
          ) : (
            <div className="text-3xl tabular-nums font-medium">
              {account?.invested.toFixed(2)} {account?.currency || "GBP"}
            </div>
          )}
        </div>

        {/* Total P&L */}
        <div
          className="p-6 rounded-lg flex flex-col gap-4"
          style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <SectionLabel>Total P&amp;L</SectionLabel>
          {accountLoading ? (
            <Skeleton className="h-9 w-36" />
          ) : (
            <div
              className="text-3xl tabular-nums font-medium"
              style={
                pnlPositive
                  ? { color: "#10b981", textShadow: "0 0 8px rgba(16,185,129,0.4)" }
                  : { color: "#f87171" }
              }
            >
              {pnlPositive && pnl !== 0 ? "+" : ""}
              {pnl.toFixed(2)} {account?.currency || "GBP"}
            </div>
          )}
        </div>
      </section>

      {/* Two-column: Positions + Signals */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Live Positions */}
        <div className="space-y-6">
          <SectionLabel>Live Positions</SectionLabel>
          <div
            className="rounded-lg overflow-hidden"
            style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {positionsLoading ? (
              <div className="p-5 space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : positions && positions.length > 0 ? (
              <div>
                {positions.map((pos, idx) => {
                  const profit = pos.pnl >= 0;
                  return (
                    <div
                      key={pos.ticker}
                      className="flex items-center justify-between p-5"
                      style={idx < positions.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}
                    >
                      <div className="flex items-center gap-4">
                        <TickerAvatar ticker={pos.ticker} />
                        <div>
                          <div className="text-sm font-medium">{pos.ticker}</div>
                          <div className="text-xs tabular-nums mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                            {pos.quantity} units · avg {pos.averagePrice.toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className="text-sm font-medium tabular-nums"
                          style={
                            profit
                              ? { color: "#10b981", textShadow: "0 0 8px rgba(16,185,129,0.4)" }
                              : { color: "#f87171" }
                          }
                        >
                          {profit ? "+" : ""}£{pos.pnl.toFixed(2)}
                        </div>
                        <div
                          className="text-xs tabular-nums mt-0.5"
                          style={{ color: profit ? "rgba(16,185,129,0.7)" : "rgba(248,113,113,0.7)" }}
                        >
                          {profit ? "+" : ""}{pos.pnlPercent.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-5 text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                No open positions
              </div>
            )}
          </div>
        </div>

        {/* Recent Signals */}
        <div className="space-y-6">
          <SectionLabel>Recent Signals</SectionLabel>
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {signalsLoading ? (
              <div className="p-3 space-y-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : signals && signals.length > 0 ? (
              signals.map((sig) => (
                <div
                  key={sig.id}
                  className="flex items-center justify-between p-3 rounded transition-colors"
                  style={{ cursor: "default" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                >
                  <div>
                    <div className="text-sm font-medium">{sig.ticker}</div>
                    <div className="text-xs mt-0.5 tabular-nums" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {new Date(sig.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div
                      className="text-right text-xs tabular-nums"
                      style={{ color: "rgba(255,255,255,0.4)" }}
                    >
                      <div>Price: {sig.price.toFixed(2)}</div>
                      <div>MA: {sig.shortMa.toFixed(2)} / {sig.longMa.toFixed(2)}</div>
                    </div>
                    <div
                      className="px-2.5 py-1 rounded text-[10px] font-bold tracking-wider"
                      style={
                        sig.signal === "BUY"
                          ? { color: "#10b981", backgroundColor: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }
                          : sig.signal === "SELL"
                          ? { color: "#f87171", backgroundColor: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)" }
                          : { color: "#d97706", backgroundColor: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.2)" }
                      }
                    >
                      {sig.signal}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-3 text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                No recent signals
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Market News */}
      <section className="space-y-6">
        <div className="flex items-center justify-between pl-1">
          <div className="flex items-center gap-3">
            <SectionLabel>Market News</SectionLabel>
            <span
              style={{
                fontSize: "10px",
                color: "rgba(255,255,255,0.25)",
                letterSpacing: "0.05em",
              }}
            >
              · auto-refreshes every 15 min
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/30 hover:text-white/60"
            onClick={refreshNews}
            disabled={newsFetching}
            title="Refresh news"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${newsFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div
          className="rounded-lg overflow-hidden"
          style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {newsLoading ? (
            <div className="p-5 space-y-4">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !news || news.length === 0 ? (
            <div className="p-5 text-sm text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
              No high-impact news at the moment
            </div>
          ) : (
            <div>
              {news.map((item, i) => (
                <a
                  key={i}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-4 p-5 transition-colors group"
                  style={i < news.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                >
                  {/* Impact dot */}
                  <div
                    className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.impactLabel === "HIGH" ? "#f87171" : "#fbbf24" }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: "rgba(255,255,255,0.9)" }}>
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{item.source}</span>
                      <span
                        className="w-1 h-1 rounded-full"
                        style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                      />
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                        {item.publishedAt
                          ? new Date(item.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : ""}
                      </span>
                    </div>
                  </div>
                  <ExternalLink
                    className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-0 group-hover:opacity-40 transition-opacity"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
