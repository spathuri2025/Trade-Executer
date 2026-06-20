import { useState } from "react";
import { useSignals } from "@/lib/engineApi";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Activity, ShieldCheck, XCircle } from "lucide-react";
import { format } from "date-fns";

export default function Signals() {
  const { data: signals, isLoading } = useSignals({ limit: 100 });
  const [filter, setFilter] = useState("ALL"); // 'ALL' | 'BUY' | 'SELL'

  const filteredSignals = signals?.filter(s => filter === "ALL" ? true : s.signal_type === filter) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Signal Feed</h2>
        <p className="text-muted-foreground">Live analytical engine output.</p>
      </div>

      <div className="flex gap-2">
        {['ALL', 'BUY', 'SELL', 'HOLD'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : filteredSignals.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">No signals found.</CardContent></Card>
        ) : (
          filteredSignals.map(signal => (
            <Card key={signal.id} className="overflow-hidden">
              <div className="flex flex-col md:flex-row items-start md:items-center">
                <div className={`w-full md:w-32 py-4 px-6 flex flex-col justify-center items-center md:border-r border-border md:h-full ${
                  signal.signal_type === 'BUY' ? 'bg-green-500/10 text-green-500' :
                  signal.signal_type === 'SELL' ? 'bg-red-500/10 text-red-500' :
                  'bg-gray-500/10 text-gray-500'
                }`}>
                  <span className="text-2xl font-black tracking-widest">{signal.signal_type}</span>
                  <span className="text-sm opacity-80 font-mono">{signal.symbol}</span>
                </div>
                
                <div className="flex-1 p-6 flex flex-col md:flex-row gap-6 md:items-center justify-between w-full">
                  <div className="space-y-2">
                    <p className="text-sm text-foreground/80">{signal.reasoning || "Algorithmic rule met"}</p>
                    <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                      <span>Price: ${signal.price_at_signal?.toFixed(4) || '--'}</span>
                      <span>Conf: {signal.confidence ? `${(signal.confidence * 100).toFixed(1)}%` : '--'}</span>
                      <span>Time: {signal.created_at ? format(new Date(signal.created_at), "HH:mm:ss yyyy-MM-dd") : '--'}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0 bg-muted/50 px-3 py-1.5 rounded-md border border-border/50">
                    {signal.acted_on === 'TRADED' ? <Activity className="w-4 h-4 text-green-400" /> : 
                     signal.acted_on === 'BLOCKED' ? <XCircle className="w-4 h-4 text-red-400" /> : 
                     signal.acted_on === 'HOLD' ? <ShieldCheck className="w-4 h-4 text-yellow-400" /> :
                     <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                    <span className="text-xs font-bold uppercase">{signal.acted_on || 'PENDING'}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
