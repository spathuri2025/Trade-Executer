import { useState } from "react";
import { useTrades } from "@/lib/engineApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowUpRight, ArrowDownRight, Clock } from "lucide-react";
import { format } from "date-fns";

export default function Trades() {
  const { data: trades, isLoading } = useTrades({ limit: 100 });
  const [filter, setFilter] = useState("ALL"); // 'ALL' | 'OPEN' | 'CLOSED'

  const filteredTrades = trades?.filter(t => filter === "ALL" ? true : t.status === filter) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Trade History</h2>
        <p className="text-muted-foreground">Complete log of all executed trades.</p>
      </div>

      <div className="flex gap-2">
        {['ALL', 'OPEN', 'CLOSED'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
             <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : filteredTrades.length === 0 ? (
             <div className="flex justify-center p-8 text-muted-foreground">No trades found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                  <tr>
                    <th className="px-6 py-4 font-medium">Time</th>
                    <th className="px-6 py-4 font-medium">Symbol</th>
                    <th className="px-6 py-4 font-medium">Type</th>
                    <th className="px-6 py-4 font-medium">Entry/Exit</th>
                    <th className="px-6 py-4 font-medium">Qty</th>
                    <th className="px-6 py-4 font-medium">P&L</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredTrades.map(trade => (
                    <tr key={trade.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-muted-foreground font-mono">
                        {trade.opened_at ? format(new Date(trade.opened_at), "yyyy-MM-dd HH:mm") : '--'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-bold">
                        {trade.symbol}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {trade.direction === 'BUY' ? <ArrowUpRight className="w-4 h-4 text-green-500" /> : <ArrowDownRight className="w-4 h-4 text-red-500" />}
                          <span className={trade.direction === 'BUY' ? 'text-green-500' : 'text-red-500'}>{trade.direction}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono">
                        {trade.entry_price?.toFixed(4) || '--'} 
                        {trade.exit_price ? ` / ${trade.exit_price.toFixed(4)}` : ''}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono">
                        {trade.quantity?.toFixed(4) || '--'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {trade.pnl != null ? (
                          <span className={`font-mono font-medium ${trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                            {trade.pnl_pct != null && ` (${(trade.pnl_pct * 100).toFixed(2)}%)`}
                          </span>
                        ) : '--'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          trade.status === 'OPEN' ? 'bg-blue-500/20 text-blue-500' : 'bg-gray-500/20 text-gray-400'
                        }`}>
                          {trade.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
