import { useEffect } from "react";
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
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Flame, AlertTriangle } from "lucide-react";

export default function Dashboard() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPositionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey({ limit: 5 }) });
    }, 180000);
    // Refresh news every 15 minutes
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

  const { data: news, isLoading: newsLoading } = useGetMarketNews({ limit: 8 }, {
    query: { queryKey: getGetMarketNewsQueryKey(), staleTime: 15 * 60 * 1000 },
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        {botLoading ? (
          <Skeleton className="h-6 w-24" />
        ) : (
          <Badge variant={botStatus?.running ? "default" : "destructive"}>
            {botStatus?.running ? "BOT ACTIVE" : "BOT STOPPED"}
            {botStatus?.config.dryRun ? " (DRY RUN)" : ""}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Account Value</CardTitle>
          </CardHeader>
          <CardContent>
            {accountLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-mono font-bold">
                {account?.total.toFixed(2)} {account?.currency || "USD"}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Invested</CardTitle>
          </CardHeader>
          <CardContent>
            {accountLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-mono font-bold">
                {account?.invested.toFixed(2)} {account?.currency || "USD"}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total PnL</CardTitle>
          </CardHeader>
          <CardContent>
            {accountLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className={`text-2xl font-mono font-bold ${account?.result && account.result >= 0 ? "text-primary" : "text-destructive"}`}>
                {account?.result && account.result > 0 ? "+" : ""}
                {account?.result.toFixed(2)} {account?.currency || "USD"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Live Positions</CardTitle>
          </CardHeader>
          <CardContent>
            {positionsLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : positions && positions.length > 0 ? (
              <div className="space-y-4">
                {positions.map((pos) => (
                  <div key={pos.ticker} className="flex justify-between items-center border-b border-border pb-3 last:border-0 last:pb-0">
                    <div>
                      <div className="font-bold font-mono">{pos.ticker}</div>
                      <div className="text-sm text-muted-foreground">{pos.quantity} shares</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm">Avg: {pos.averagePrice.toFixed(2)}</div>
                      <div className={`font-mono text-sm ${pos.pnl >= 0 ? "text-primary" : "text-destructive"}`}>
                        {pos.pnl >= 0 ? "+" : ""}{pos.pnl.toFixed(2)} ({pos.pnlPercent.toFixed(2)}%)
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm py-4">No open positions</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Signals</CardTitle>
          </CardHeader>
          <CardContent>
            {signalsLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : signals && signals.length > 0 ? (
              <div className="space-y-4">
                {signals.map((sig) => (
                  <div key={sig.id} className="flex justify-between items-center border-b border-border pb-3 last:border-0 last:pb-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-mono">{sig.ticker}</span>
                        <Badge variant="outline" className={
                          sig.signal === "BUY" ? "text-primary border-primary bg-primary/10" :
                          sig.signal === "SELL" ? "text-destructive border-destructive bg-destructive/10" :
                          "text-amber-500 border-amber-500 bg-amber-500/10"
                        }>
                          {sig.signal}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(sig.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right font-mono text-sm">
                      <div>Price: {sig.price.toFixed(2)}</div>
                      <div className="text-muted-foreground text-xs">MA: {sig.shortMa.toFixed(2)} / {sig.longMa.toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm py-4">No recent signals</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Market-moving news */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            Market-Moving News
            <span className="ml-auto text-xs text-muted-foreground font-normal">Refreshes every 15 min</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {newsLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !news || news.length === 0 ? (
            <div className="text-muted-foreground text-sm py-4 text-center">No high-impact news at the moment</div>
          ) : (
            <div className="divide-y divide-border">
              {news.map((item, i) => (
                <a
                  key={i}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 py-3 hover:bg-muted/20 rounded px-2 -mx-2 transition-colors group"
                >
                  <div className="mt-0.5 shrink-0">
                    {item.impactLabel === "HIGH" ? (
                      <Flame className="h-4 w-4 text-orange-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{item.source}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        {item.publishedAt ? new Date(item.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                      <Badge
                        variant="outline"
                        className={`ml-auto text-xs ${item.impactLabel === "HIGH" ? "border-orange-500 text-orange-500" : "border-yellow-500 text-yellow-500"}`}
                      >
                        {item.impactLabel}
                      </Badge>
                    </div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
