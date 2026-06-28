import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBotStatus,
  getGetBotStatusQueryKey,
  useUpdateBotConfig,
  useStartBot,
  useStopBot
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, Square } from "lucide-react";

type BrokerName = "trading212" | "capitalcom";

const BROKER_LABELS: Record<BrokerName, string> = {
  trading212: "Trading 212",
  capitalcom: "Capital.com",
};

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: botStatus, isLoading } = useGetBotStatus({
    query: { queryKey: getGetBotStatusQueryKey() }
  });

  const [config, setConfig] = useState({
    shortPeriod: 9,
    longPeriod: 21,
    tradeAmount: 100,
    intervalMinutes: 15,
    dryRun: true,
    broker: "capitalcom" as BrokerName,
    stopLossPercent: 2,
    riskPerTradePercent: 1,
  });

  useEffect(() => {
    if (botStatus?.config) {
      setConfig({
        shortPeriod: botStatus.config.shortPeriod,
        longPeriod: botStatus.config.longPeriod,
        tradeAmount: botStatus.config.tradeAmount,
        intervalMinutes: botStatus.config.intervalMinutes,
        dryRun: botStatus.config.dryRun,
        broker: botStatus.config.broker as BrokerName,
        stopLossPercent: botStatus.config.stopLossPercent,
        riskPerTradePercent: botStatus.config.riskPerTradePercent,
      });
    }
  }, [botStatus]);

  const updateConfig = useUpdateBotConfig({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        toast({ title: "Configuration saved successfully" });
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast({ title: "Failed to save configuration", description: message, variant: "destructive" });
      }
    }
  });

  const startBot = useStartBot({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        toast({ title: "Bot started" });
      }
    }
  });

  const stopBot = useStopBot({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        toast({ title: "Bot stopped" });
      }
    }
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate({ data: config });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl md:text-4xl font-light tracking-tight">Settings</h1>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-4xl font-light tracking-tight">Bot Controls &amp; Settings</h1>

      {/* Engine status */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle>Engine Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="text-lg font-bold">
              {botStatus?.running ? (
                <span className="text-primary flex items-center gap-2">
                  <Play className="h-5 w-5" /> RUNNING
                </span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Square className="h-5 w-5" /> STOPPED
                </span>
              )}
            </div>
            {botStatus?.running && (
              <div className="text-sm text-muted-foreground font-mono">
                Next run: {botStatus.nextRunAt ? new Date(botStatus.nextRunAt).toLocaleString() : "Pending"}
              </div>
            )}
          </div>
          <div>
            {botStatus?.running ? (
              <Button
                variant="destructive"
                className="w-full sm:w-auto"
                onClick={() => stopBot.mutate()}
                disabled={stopBot.isPending}
                data-testid="button-stop-bot"
              >
                <Square className="mr-2 h-4 w-4" /> Stop Engine
              </Button>
            ) : (
              <Button
                className="w-full sm:w-auto"
                onClick={() => startBot.mutate()}
                disabled={startBot.isPending}
                data-testid="button-start-bot"
              >
                <Play className="mr-2 h-4 w-4" /> Start Engine
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Strategy config */}
      <Card>
        <CardHeader>
          <CardTitle>Strategy Configuration</CardTitle>
          <CardDescription>Moving Average Crossover — broker, periods, and trade size</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">

            {/* Broker selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Active Broker</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(["capitalcom", "trading212"] as BrokerName[]).map((b) => (
                  <button
                    key={b}
                    type="button"
                    data-testid={`button-broker-${b}`}
                    onClick={() => setConfig({ ...config, broker: b })}
                    className={[
                      "rounded-lg border px-4 py-3 text-sm font-medium transition-all text-left",
                      config.broker === b
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/20 text-muted-foreground hover:border-primary/40",
                    ].join(" ")}
                  >
                    <div className="font-semibold">{BROKER_LABELS[b]}</div>
                    <div className="text-xs mt-0.5 opacity-70">
                      {b === "capitalcom" ? "Capital.com live account" : "Trading 212 live account"}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Short MA Period</label>
                <Input
                  type="number"
                  value={config.shortPeriod}
                  onChange={(e) => setConfig({ ...config, shortPeriod: Number(e.target.value) })}
                  className="font-mono"
                  min={1}
                  data-testid="input-short-period"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Long MA Period</label>
                <Input
                  type="number"
                  value={config.longPeriod}
                  onChange={(e) => setConfig({ ...config, longPeriod: Number(e.target.value) })}
                  className="font-mono"
                  min={2}
                  data-testid="input-long-period"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Risk Per Trade (%)</label>
                <Input
                  type="number"
                  value={config.riskPerTradePercent}
                  onChange={(e) => setConfig({ ...config, riskPerTradePercent: Number(e.target.value) })}
                  className="font-mono"
                  min={0} max={10} step={0.1}
                  data-testid="input-risk-per-trade"
                />
                <p className="text-xs text-muted-foreground">
                  {config.riskPerTradePercent > 0
                    ? `Sizes position to ${config.riskPerTradePercent}% of account. Set 0 to use fixed amount.`
                    : "Using fixed Trade Amount below."}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Stop-Loss (%)</label>
                <Input
                  type="number"
                  value={config.stopLossPercent}
                  onChange={(e) => setConfig({ ...config, stopLossPercent: Number(e.target.value) })}
                  className="font-mono"
                  min={0} max={20} step={0.1}
                  data-testid="input-stop-loss"
                />
                <p className="text-xs text-muted-foreground">
                  {config.stopLossPercent > 0
                    ? `Stop ${config.stopLossPercent}% from entry. Set 0 to disable.`
                    : "No stop-loss (not recommended for live trading)."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className={`text-sm font-medium ${config.riskPerTradePercent > 0 ? "text-muted-foreground" : ""}`}>
                  Fixed Trade Amount {config.riskPerTradePercent > 0 ? "(overridden)" : ""}
                </label>
                <Input
                  type="number"
                  value={config.tradeAmount}
                  onChange={(e) => setConfig({ ...config, tradeAmount: Number(e.target.value) })}
                  className="font-mono"
                  min={1} step={0.01}
                  disabled={config.riskPerTradePercent > 0}
                  data-testid="input-trade-amount"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Interval (Minutes)</label>
                <Input
                  type="number"
                  value={config.intervalMinutes}
                  onChange={(e) => setConfig({ ...config, intervalMinutes: Number(e.target.value) })}
                  className="font-mono"
                  min={1}
                  data-testid="input-interval-minutes"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/20">
              <div className="space-y-0.5 pr-4">
                <label className="text-sm font-medium">Dry Run Mode</label>
                <div className="text-xs text-muted-foreground">
                  Log signals without executing real trades on {BROKER_LABELS[config.broker]}
                </div>
              </div>
              <Switch
                checked={config.dryRun}
                onCheckedChange={(checked) => setConfig({ ...config, dryRun: checked })}
                data-testid="switch-dry-run"
              />
            </div>

            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={updateConfig.isPending}
              data-testid="button-save-config"
            >
              {updateConfig.isPending ? "Saving…" : "Save Configuration"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
