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
} from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPositionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey({ limit: 5 }) });
    }, 30000);
    return () => clearInterval(interval);
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
    </div>
  );
}
