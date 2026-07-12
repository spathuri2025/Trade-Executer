import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetScannerStatus,
  getGetScannerStatusQueryKey,
  useUpdateScannerConfig,
  useRunScan,
  useGetScannerResults,
  getGetScannerResultsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ScanSearch, Play, Square, RefreshCw, TrendingUp, TrendingDown, Zap } from "lucide-react";

const INSTRUMENT_TYPE_OPTIONS = [
  { value: "SHARES", label: "Shares" },
  { value: "INDICES", label: "Indices" },
  { value: "CURRENCIES", label: "Forex" },
  { value: "COMMODITIES", label: "Commodities" },
  { value: "CRYPTOCURRENCIES", label: "Crypto" },
];

export default function Scanner() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: status, isLoading: statusLoading } = useGetScannerStatus({
    query: { queryKey: getGetScannerStatusQueryKey(), refetchInterval: 10_000 }
  });

  const { data: results, isLoading: resultsLoading } = useGetScannerResults(undefined, {
    query: { queryKey: getGetScannerResultsQueryKey(), refetchInterval: 30_000 }
  });

  const [config, setConfig] = useState({
    scanEnabled: false,
    autoTrade: false,
    minTrendStrength: 0.3,
    scanIntervalMinutes: 60,
    instrumentTypes: ["SHARES", "INDICES", "CURRENCIES", "COMMODITIES"],
    maxInstrumentsPerScan: 40,
  });

  const [configInitialised, setConfigInitialised] = useState(false);
  if (status?.config && !configInitialised) {
    setConfig({
      scanEnabled: status.config.scanEnabled,
      autoTrade: status.config.autoTrade,
      minTrendStrength: status.config.minTrendStrength,
      scanIntervalMinutes: status.config.scanIntervalMinutes,
      instrumentTypes: status.config.instrumentTypes as string[],
      maxInstrumentsPerScan: status.config.maxInstrumentsPerScan,
    });
    setConfigInitialised(true);
  }

  const updateConfig = useUpdateScannerConfig({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetScannerStatusQueryKey() });
        toast({ title: "Scanner configuration saved" });
      },
      onError: () => toast({ title: "Failed to save scanner config", variant: "destructive" }),
    }
  });

  const runScan = useRunScan({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetScannerStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetScannerResultsQueryKey() });
        toast({ title: `Scan complete — ${data.hits} hits from ${data.scanned} instruments` });
      },
      onError: () => toast({ title: "Scan failed", variant: "destructive" }),
    }
  });

  const toggleType = (type: string) => {
    const current = config.instrumentTypes;
    setConfig({
      ...config,
      instrumentTypes: current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type],
    });
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate({ data: config });
  };

  if (statusLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Market Scanner</h1>
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  const isScanning = status?.scanning ?? false;
  const isRunning = status?.running ?? false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <ScanSearch className="h-8 w-8 text-primary" />
            Market Scanner
          </h1>
          <p className="text-muted-foreground mt-1">
            Automatically scans Capital.com markets for MA crossover opportunities
          </p>
        </div>
        <Button
          onClick={() => runScan.mutate()}
          disabled={runScan.isPending || isScanning}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isScanning ? "animate-spin" : ""}`} />
          {isScanning ? "Scanning…" : "Scan Now"}
        </Button>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="border-primary/20">
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</div>
            <div className={`font-bold flex items-center gap-2 ${isRunning ? "text-primary" : "text-muted-foreground"}`}>
              {isRunning ? <><Play className="h-4 w-4" /> AUTO-SCAN ON</> : <><Square className="h-4 w-4" /> OFF</>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Last Scanned</div>
            <div className="font-bold font-mono text-sm">
              {status?.lastRunAt ? new Date(status.lastRunAt).toLocaleTimeString() : "Never"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Instruments Checked</div>
            <div className="font-bold text-xl">{status?.lastScanCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Hits Found</div>
            <div className="font-bold text-xl text-primary">{status?.lastHitCount ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Config */}
        <Card>
          <CardHeader>
            <CardTitle>Scanner Configuration</CardTitle>
            <CardDescription>Set criteria for screening instruments</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveConfig} className="space-y-5">

              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                <div>
                  <div className="text-sm font-medium">Auto-Scan</div>
                  <div className="text-xs text-muted-foreground">Run automatically on schedule</div>
                </div>
                <Switch
                  checked={config.scanEnabled}
                  onCheckedChange={(v) => setConfig({ ...config, scanEnabled: v })}
                />
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    Auto-Trade on Hit
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Execute orders when scanner finds a signal (uses bot risk settings)
                  </div>
                </div>
                <Switch
                  checked={config.autoTrade}
                  onCheckedChange={(v) => setConfig({ ...config, autoTrade: v })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Min Trend Strength (%)</label>
                  <Input
                    type="number"
                    value={config.minTrendStrength}
                    onChange={(e) => setConfig({ ...config, minTrendStrength: Number(e.target.value) })}
                    className="font-mono"
                    min={0} max={10} step={0.1}
                  />
                  <p className="text-xs text-muted-foreground">Min % gap between short and long MA</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Scan Interval (min)</label>
                  <Input
                    type="number"
                    value={config.scanIntervalMinutes}
                    onChange={(e) => setConfig({ ...config, scanIntervalMinutes: Number(e.target.value) })}
                    className="font-mono"
                    min={1}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Max Instruments</label>
                  <Input
                    type="number"
                    value={config.maxInstrumentsPerScan}
                    onChange={(e) => setConfig({ ...config, maxInstrumentsPerScan: Number(e.target.value) })}
                    className="font-mono"
                    min={5} max={200} step={5}
                  />
                  <p className="text-xs text-muted-foreground">Higher = slower, more thorough</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Instrument Types</label>
                <div className="flex flex-wrap gap-2">
                  {INSTRUMENT_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleType(opt.value)}
                      className={[
                        "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                        config.instrumentTypes.includes(opt.value)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={updateConfig.isPending} className="w-full">
                {updateConfig.isPending ? "Saving…" : "Save Configuration"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader>
            <CardTitle>Scanner Hits</CardTitle>
            <CardDescription>Instruments that matched your criteria</CardDescription>
          </CardHeader>
          <CardContent>
            {resultsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !results || results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <ScanSearch className="h-12 w-12 opacity-20" />
                <p className="text-sm">No hits yet — run a scan to find opportunities</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {results.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/10 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={r.signal === "BUY" ? "text-primary" : "text-destructive"}>
                        {r.signal === "BUY"
                          ? <TrendingUp className="h-4 w-4" />
                          : <TrendingDown className="h-4 w-4" />}
                      </div>
                      <div>
                        <div className="font-mono font-semibold text-sm">{r.ticker}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[140px]">{r.name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Strength</div>
                        <div className="font-mono text-sm font-semibold">
                          {Number(r.trendStrength).toFixed(2)}%
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 items-end">
                        <Badge variant={r.signal === "BUY" ? "default" : "destructive"} className="text-xs">
                          {r.signal}
                        </Badge>
                        {r.autoTraded && (
                          <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-500 gap-1">
                            <Zap className="h-3 w-3" /> Traded
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Next scan info */}
      {isRunning && status?.nextRunAt && (
        <p className="text-xs text-muted-foreground text-center font-mono">
          Next auto-scan: {new Date(status.nextRunAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
