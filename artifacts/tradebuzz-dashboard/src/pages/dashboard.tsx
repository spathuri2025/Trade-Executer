import { useBotStatus, useTrades, useSignals, useStartBot, useStopBot, usePauseBot, useResumeBot, useRunCycle } from "@/lib/engineApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Square, Pause, RefreshCw, TrendingUp, TrendingDown, ArrowRight, ArrowLeft, Activity } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function Dashboard() {
  const { data: botStatus, isLoading: botLoading } = useBotStatus();
  const { data: trades, isLoading: tradesLoading } = useTrades({ limit: 10 });
  const { data: signals, isLoading: signalsLoading } = useSignals({ limit: 10 });
  
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const pauseBot = usePauseBot();
  const resumeBot = useResumeBot();
  const runCycle = useRunCycle();

  const handleRunCycle = () => {
    runCycle.mutate(undefined, {
      onSuccess: (res) => toast.success(`Cycle completed`, { description: `Attempted ${res.trades_attempted} trades` }),
      onError: (err) => toast.error("Cycle failed", { description: err.message })
    });
  };

  const handleControl = (action: 'start' | 'stop' | 'pause' | 'resume') => {
    const mutations = {
      start: startBot,
      stop: stopBot,
      pause: pauseBot,
      resume: resumeBot
    };
    mutations[action].mutate(undefined, {
      onSuccess: () => toast.success(`Bot ${action}ed`),
      onError: (err) => toast.error(`Failed to ${action}`, { description: err.message })
    });
  };

  const isPending = startBot.isPending || stopBot.isPending || pauseBot.isPending || resumeBot.isPending;

  const totalPnl = trades?.reduce((acc, t) => acc + (t.pnl || 0), 0) || 0;
  const winRate = trades?.length ? trades.filter(t => (t.pnl || 0) > 0).length / trades.length : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Operations Overview</h2>
          <p className="text-muted-foreground">Monitor and control your automated trading systems.</p>
        </div>
        <div className="flex items-center gap-2 bg-card p-2 rounded-md border border-border">
          <Button variant={botStatus?.state === 'RUNNING' ? 'default' : 'outline'} size="sm" onClick={() => handleControl('start')} disabled={isPending || botStatus?.state === 'RUNNING'}>
            <Play className="w-4 h-4 mr-2" /> Start
          </Button>
          <Button variant={botStatus?.state === 'PAUSED' ? 'default' : 'outline'} size="sm" onClick={() => botStatus?.state === 'PAUSED' ? handleControl('resume') : handleControl('pause')} disabled={isPending || botStatus?.state === 'STOPPED' || botStatus?.state === 'EMERGENCY_STOP'}>
            <Pause className="w-4 h-4 mr-2" /> {botStatus?.state === 'PAUSED' ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleControl('stop')} disabled={isPending || botStatus?.state === 'STOPPED'}>
            <Square className="w-4 h-4 mr-2 text-destructive" /> Stop
          </Button>
          <div className="w-px h-6 bg-border mx-2"></div>
          <Button variant="secondary" size="sm" onClick={handleRunCycle} disabled={runCycle.isPending}>
            {runCycle.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Force Cycle
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Session P&L</CardTitle>
            <TrendingUp className={`h-4 w-4 ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              ${totalPnl.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">Across recent 10 trades</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(winRate * 100).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Recent session performance</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bot Uptime</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {botStatus?.started_at ? format(new Date(botStatus.started_at), 'HH:mm:ss') : '--:--:--'}
            </div>
            <p className="text-xs text-muted-foreground">Since last start</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Signals</CardTitle>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{signals?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Recent generated signals</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Trades</CardTitle>
            <CardDescription>Latest execution history</CardDescription>
          </CardHeader>
          <CardContent>
            {tradesLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : trades?.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No recent trades</p>
            ) : (
              <div className="space-y-4">
                {trades?.map((trade) => (
                  <div key={trade.id} className="flex items-center justify-between border-b border-border pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-2 rounded-full ${trade.direction === 'BUY' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <div>
                        <p className="text-sm font-medium leading-none">{trade.symbol}</p>
                        <p className="text-sm text-muted-foreground">{trade.direction} • {trade.quantity}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-medium ${trade.pnl && trade.pnl >= 0 ? 'text-green-500' : trade.pnl && trade.pnl < 0 ? 'text-red-500' : ''}`}>
                        {trade.pnl ? `$${trade.pnl.toFixed(2)}` : '--'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {trade.entry_price ? `@ $${trade.entry_price.toFixed(2)}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Latest Signals</CardTitle>
            <CardDescription>Engine analysis feed</CardDescription>
          </CardHeader>
          <CardContent>
            {signalsLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : signals?.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No recent signals</p>
            ) : (
              <div className="space-y-4">
                {signals?.slice(0, 5).map((signal) => (
                  <div key={signal.id} className="flex items-center justify-between border-b border-border pb-4 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2">
                        {signal.symbol} 
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${signal.signal_type === 'BUY' ? 'bg-green-500/20 text-green-500' : signal.signal_type === 'SELL' ? 'bg-red-500/20 text-red-500' : 'bg-gray-500/20 text-gray-500'}`}>
                          {signal.signal_type}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 truncate max-w-[150px]">{signal.reasoning || "Algorithm triggered"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono">{signal.confidence ? `${(signal.confidence * 100).toFixed(0)}% conf` : '--'}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {signal.created_at ? format(new Date(signal.created_at), 'HH:mm:ss') : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
