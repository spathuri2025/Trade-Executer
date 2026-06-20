import { useState } from "react";
import { useLogs } from "@/lib/engineApi";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Terminal, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { format } from "date-fns";

export default function Logs() {
  const [level, setLevel] = useState<string>("ALL");
  const { data: logs, isLoading } = useLogs({ limit: 200, level: level === "ALL" ? undefined : level });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">System Logs</h2>
        <p className="text-muted-foreground">Raw engine output and diagnostic events.</p>
      </div>

      <div className="flex gap-2 shrink-0">
        {['ALL', 'INFO', 'WARNING', 'ERROR'].map(l => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={`px-4 py-1.5 text-xs font-mono rounded-md transition-colors ${
              level === l 
                ? l === 'ERROR' ? 'bg-destructive text-destructive-foreground' 
                : l === 'WARNING' ? 'bg-yellow-500 text-yellow-950'
                : 'bg-primary text-primary-foreground' 
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <Card className="flex-1 overflow-hidden flex flex-col bg-[#0a0a0a] border-border/50">
        <div className="bg-muted/30 border-b border-border/50 p-2 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground">engine_output.log</span>
        </div>
        <CardContent className="p-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : logs?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground font-mono text-sm">No logs found for current filters.</div>
          ) : (
            <div className="p-4 font-mono text-sm space-y-1">
              {logs?.map(log => (
                <div key={log.id} className="flex items-start gap-4 py-1 hover:bg-white/5 group">
                  <div className="shrink-0 text-muted-foreground opacity-50 w-24">
                    {log.created_at ? format(new Date(log.created_at), "HH:mm:ss") : '--'}
                  </div>
                  
                  <div className={`shrink-0 w-20 font-bold ${
                    log.level === 'ERROR' || log.level === 'CRITICAL' ? 'text-red-500' :
                    log.level === 'WARNING' ? 'text-yellow-500' :
                    'text-blue-400'
                  }`}>
                    [{log.level}]
                  </div>
                  
                  <div className="flex-1 break-all text-gray-300">
                    <span className="text-primary/70 mr-2">({log.event})</span>
                    {log.message}
                    {log.symbol && <span className="ml-2 px-1.5 py-0.5 rounded bg-white/10 text-xs">{log.symbol}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
