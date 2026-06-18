import { useListSignals, getListSignalsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";

export default function Signals() {
  const { data: signals, isLoading } = useListSignals(undefined, {
    query: { queryKey: getListSignalsQueryKey() }
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Signal Log</h1>
      <Card>
        <CardHeader>
          <CardTitle>Strategy Signals</CardTitle>
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
                    <th className="px-4 py-3">Signal</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Short MA</th>
                    <th className="px-4 py-3">Long MA</th>
                    <th className="px-4 py-3">Trade Executed</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {signals?.map((signal) => (
                    <tr key={signal.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">{new Date(signal.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 font-bold">{signal.ticker}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={
                          signal.signal === "BUY" ? "text-primary border-primary bg-primary/10" :
                          signal.signal === "SELL" ? "text-destructive border-destructive bg-destructive/10" :
                          "text-amber-500 border-amber-500 bg-amber-500/10"
                        }>
                          {signal.signal}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{signal.price.toFixed(2)}</td>
                      <td className="px-4 py-3">{signal.shortMa.toFixed(2)}</td>
                      <td className="px-4 py-3">{signal.longMa.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        {signal.tradeExecuted ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground" />
                        )}
                      </td>
                    </tr>
                  ))}
                  {(!signals || signals.length === 0) && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground font-sans">
                        No signals generated yet.
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
