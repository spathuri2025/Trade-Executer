import { useListTrades, getListTradesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Trades() {
  const { data: trades, isLoading } = useListTrades(undefined, {
    query: { queryKey: getListTradesQueryKey() }
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Trade History</h1>
      <Card>
        <CardHeader>
          <CardTitle>All Executions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Ticker</th>
                    <th className="px-4 py-3">Side</th>
                    <th className="px-4 py-3">Qty</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {trades?.map((trade) => (
                    <tr key={trade.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">{new Date(trade.executedAt).toLocaleString()}</td>
                      <td className="px-4 py-3 font-bold">{trade.ticker}</td>
                      <td className="px-4 py-3">
                        <span className={trade.side === "BUY" ? "text-primary" : "text-destructive"}>
                          {trade.side}
                        </span>
                      </td>
                      <td className="px-4 py-3">{trade.quantity}</td>
                      <td className="px-4 py-3">{trade.price.toFixed(2)}</td>
                      <td className="px-4 py-3">{trade.total ? trade.total.toFixed(2) : '-'}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={
                          trade.status === "FILLED" ? "text-primary border-primary bg-primary/10" :
                          trade.status === "FAILED" ? "text-destructive border-destructive bg-destructive/10" :
                          "text-amber-500 border-amber-500 bg-amber-500/10"
                        }>
                          {trade.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {(!trades || trades.length === 0) && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground font-sans">
                        No trades found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
