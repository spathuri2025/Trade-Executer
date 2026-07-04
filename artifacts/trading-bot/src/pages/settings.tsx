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
import { useAdminMode } from "@/hooks/use-admin-mode";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, Square } from "lucide-react";

type BrokerName = "trading212" | "capitalcom";
type AiTradeMode = "off" | "guard" | "autonomous";

const BROKER_LABELS: Record<BrokerName, string> = {
  trading212: "Trading 212",
  capitalcom: "Capital.com",
};

const AI_MODES: { value: AiTradeMode; title: string; desc: string }[] = [
  {
    value: "off",
    title: "Strategy only",
    desc: "The moving-average strategy decides trades on its own. Claude is not involved.",
  },
  {
    value: "guard",
    title: "Claude safety check",
    desc: "The strategy finds a signal, then Claude reviews it and approves or blocks it before any order is placed.",
  },
  {
    value: "autonomous",
    title: "Claude decides",
    desc: "Claude itself decides what to buy or sell from your live data, then places the order.",
  },
];

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAdmin, setAdmin } = useAdminMode();

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
    takeProfitPercent: 4,
    riskPerTradePercent: 1,
    maxPositionSizePercent: 5,
    maxDailyLossPercent: 3,
    maxConcurrentPositions: 5,
    aiTradeMode: "off" as AiTradeMode,
    regimeFilterEnabled: true,
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
        takeProfitPercent: botStatus.config.takeProfitPercent,
        riskPerTradePercent: botStatus.config.riskPerTradePercent,
        maxPositionSizePercent: botStatus.config.maxPositionSizePercent,
        maxDailyLossPercent: botStatus.config.maxDailyLossPercent,
        maxConcurrentPositions: botStatus.config.maxConcurrentPositions,
        aiTradeMode: (botStatus.config.aiTradeMode as AiTradeMode) ?? "off",
        regimeFilterEnabled: botStatus.config.regimeFilterEnabled ?? true,
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

      {/* Admin mode */}
      <Card>
        <CardHeader>
          <CardTitle>Admin Mode</CardTitle>
          <CardDescription>
            Unlocks admin-only controls such as generating the AI Daily Market Brief.
            This is a local toggle only and is not a security boundary.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/20">
            <div className="space-y-0.5 pr-4">
              <label className="text-sm font-medium">Enable Admin Mode</label>
              <div className="text-xs text-muted-foreground">
                Shows the &ldquo;Generate Today&apos;s Brief&rdquo; button on the dashboard.
              </div>
            </div>
            <Switch
              checked={isAdmin}
              onCheckedChange={setAdmin}
              data-testid="switch-admin-mode"
            />
          </div>
        </CardContent>
      </Card>

      {/* AI trade mode */}
      <Card>
        <CardHeader>
          <CardTitle>AI Trade Mode</CardTitle>
          <CardDescription>
            Choose how Claude (AI) takes part in placing trades. Changes save with the button below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {AI_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              data-testid={`button-ai-mode-${mode.value}`}
              onClick={() => setConfig({ ...config, aiTradeMode: mode.value })}
              className={[
                "w-full rounded-lg border px-4 py-3 text-left transition-all",
                config.aiTradeMode === mode.value
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted/20 hover:border-primary/40",
              ].join(" ")}
            >
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "h-3.5 w-3.5 rounded-full border shrink-0",
                    config.aiTradeMode === mode.value ? "border-primary bg-primary" : "border-muted-foreground",
                  ].join(" ")}
                />
                <span className={`text-sm font-semibold ${config.aiTradeMode === mode.value ? "text-primary" : ""}`}>
                  {mode.title}
                </span>
              </div>
              <div className="text-xs mt-1 pl-5.5 text-muted-foreground">{mode.desc}</div>
            </button>
          ))}
          {config.aiTradeMode !== "off" && (
            <div className="text-xs rounded-md p-3 border border-amber-500/40 bg-amber-500/10 text-amber-500">
              {config.dryRun
                ? "Dry Run is ON, so Claude's decisions are simulated only — no real orders are sent. Watch them here before going live."
                : "Dry Run is OFF — Claude's decisions will place REAL orders with real money. Turn Dry Run back on to test safely first."}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Market regime filter */}
      <Card>
        <CardHeader>
          <CardTitle>Market Regime Filter</CardTitle>
          <CardDescription>
            Automatically pick the right strategy per instrument based on market conditions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Adaptive strategy routing</p>
              <p className="text-xs text-muted-foreground max-w-md">
                When ON, each instrument is classified as <span className="text-sky-400">Trending</span> or{" "}
                <span className="text-violet-400">Ranging</span> (via ADX) and routed to the matching
                strategy — trend-following in trends, mean-reversion in ranges. When OFF, only
                trend-following (MA crossover) runs.
              </p>
            </div>
            <Switch
              checked={config.regimeFilterEnabled}
              onCheckedChange={(checked) => setConfig({ ...config, regimeFilterEnabled: checked })}
              data-testid="switch-regime-filter"
            />
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

            {/* Risk management limits */}
            <div className="space-y-4 rounded-lg border border-border bg-muted/10 p-4">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold">Risk Management</h3>
                <p className="text-xs text-muted-foreground">
                  Hard limits enforced by the engine before any order is placed — they apply in every mode (strategy, guard, autonomous).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Take-Profit (%)</label>
                  <Input
                    type="number"
                    value={config.takeProfitPercent}
                    onChange={(e) => setConfig({ ...config, takeProfitPercent: Number(e.target.value) })}
                    className="font-mono"
                    min={0} max={50} step={0.1}
                    data-testid="input-take-profit"
                  />
                  <p className="text-xs text-muted-foreground">
                    {config.takeProfitPercent > 0
                      ? `Target ${config.takeProfitPercent}% from entry. Capital.com only. Set 0 to disable.`
                      : "No take-profit. Capital.com only."}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Position Size (%)</label>
                  <Input
                    type="number"
                    value={config.maxPositionSizePercent}
                    onChange={(e) => setConfig({ ...config, maxPositionSizePercent: Number(e.target.value) })}
                    className="font-mono"
                    min={0} max={100} step={0.1}
                    data-testid="input-max-position-size"
                  />
                  <p className="text-xs text-muted-foreground">
                    {config.maxPositionSizePercent > 0
                      ? `A single trade can never exceed ${config.maxPositionSizePercent}% of account value.`
                      : "No per-position cap (not recommended)."}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Daily Loss (%)</label>
                  <Input
                    type="number"
                    value={config.maxDailyLossPercent}
                    onChange={(e) => setConfig({ ...config, maxDailyLossPercent: Number(e.target.value) })}
                    className="font-mono"
                    min={0} max={100} step={0.1}
                    data-testid="input-max-daily-loss"
                  />
                  <p className="text-xs text-muted-foreground">
                    {config.maxDailyLossPercent > 0
                      ? `If the account drops ${config.maxDailyLossPercent}% in a day, the engine stops until you resume it.`
                      : "Daily-loss circuit breaker disabled (not recommended)."}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Concurrent Positions</label>
                  <Input
                    type="number"
                    value={config.maxConcurrentPositions}
                    onChange={(e) => setConfig({ ...config, maxConcurrentPositions: Number(e.target.value) })}
                    className="font-mono"
                    min={0} step={1}
                    data-testid="input-max-concurrent-positions"
                  />
                  <p className="text-xs text-muted-foreground">
                    {config.maxConcurrentPositions > 0
                      ? `New positions (long or short) are blocked once ${config.maxConcurrentPositions} are open.`
                      : "No limit on open positions (not recommended)."}
                  </p>
                </div>
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
