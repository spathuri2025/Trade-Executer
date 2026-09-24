import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBotStatus,
  getGetBotStatusQueryKey,
  useUpdateBotConfig,
  useStartBot,
  useStopBot,
  useGetBrokerStatus,
  getGetBrokerStatusQueryKey,
  useConnectBroker,
  useDisconnectBroker,
  useGetPlan,
  getGetPlanQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAdminMode } from "@/hooks/use-admin-mode";
import { Skeleton } from "@/components/ui/skeleton";
import { RequestUpgradeButton } from "@/components/RequestUpgradeButton";
import { ChangePasswordCard } from "@/components/ChangePasswordCard";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { TradingModeSwitch } from "@/components/TradingModeSwitch";
import { Play, Square, Link2, Unlink } from "lucide-react";

type BrokerName = "trading212" | "capitalcom";
type AiTradeMode = "off" | "guard" | "autonomous";
type MinAiConfidence = "any" | "medium" | "high";
type StrategyMode = "auto" | "scalp";
type BarResolution = "MINUTE" | "MINUTE_5" | "MINUTE_15" | "MINUTE_30" | "HOUR" | "HOUR_4" | "DAY" | "WEEK";

const BROKER_LABELS: Record<BrokerName, string> = {
  trading212: "Trading 212",
  capitalcom: "Capital.com",
};

// Same value set as charts.tsx's resolution picker — this is what the bot,
// scanner, and backtest all fetch signal bars at (the scanner always mirrors
// whatever's set here, it has no independent resolution of its own).
const RESOLUTIONS: { value: BarResolution; label: string }[] = [
  { value: "MINUTE", label: "1 min" },
  { value: "MINUTE_5", label: "5 min" },
  { value: "MINUTE_15", label: "15 min" },
  { value: "MINUTE_30", label: "30 min" },
  { value: "HOUR", label: "1 hour" },
  { value: "HOUR_4", label: "4 hour" },
  { value: "DAY", label: "1 day" },
  { value: "WEEK", label: "1 week" },
];

const AI_MODES: { value: AiTradeMode; title: string; desc: string }[] = [
  {
    value: "off",
    title: "Strategy only",
    desc: "The moving-average strategy decides trades on its own. AI is not involved.",
  },
  {
    value: "guard",
    title: "AI safety check",
    desc: "The strategy finds a signal, then AI reviews it and approves or blocks it before any order is placed.",
  },
  {
    value: "autonomous",
    title: "AI decides",
    desc: "AI itself decides what to buy or sell from your live data, then places the order.",
  },
];

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAdmin, setAdmin } = useAdminMode();

  const { data: botStatus, isLoading } = useGetBotStatus({
    query: { queryKey: getGetBotStatusQueryKey() }
  });

  const { data: planStatus } = useGetPlan({ query: { queryKey: getGetPlanQueryKey() } });
  // Default to UNLOCKED while the plan is still loading, so the controls don't
  // flicker from disabled to enabled for paying users. The server enforces the
  // real boundary regardless — this is presentation only.
  const liveTradingLocked = planStatus ? !planStatus.limits.liveTrading : false;
  const aiModesLocked = planStatus ? !planStatus.limits.aiTradeModes : false;

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
    minAiConfidence: "any" as MinAiConfidence,
    strategyMode: "auto" as StrategyMode,
    minEdgeVsSpread: 3,
    maxTradesPerDay: 50,
    maxIntradayDrawdownPercent: 2,
    closeBeforeSessionEndMinutes: 0,
    maxInstrumentExposurePercent: 0,
    maxTotalExposurePercent: 0,
    dailyProfitTarget: 0,
    equityFloor: 0,
    maxWeeklyLossPercent: 5,
    maxConsecutiveLosses: 6,
    reentryCooldownMinutes: 5,
    onePositionPerInstrument: true,
    maxNetDirectionalPercent: 0,
    regimeFilterEnabled: true,
    barResolution: "MINUTE_5" as BarResolution,
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
        minAiConfidence: (botStatus.config.minAiConfidence as MinAiConfidence) ?? "any",
        strategyMode: (botStatus.config.strategyMode as StrategyMode) ?? "auto",
        minEdgeVsSpread: botStatus.config.minEdgeVsSpread ?? 3,
        maxTradesPerDay: botStatus.config.maxTradesPerDay ?? 50,
        maxIntradayDrawdownPercent: botStatus.config.maxIntradayDrawdownPercent ?? 2,
        closeBeforeSessionEndMinutes: botStatus.config.closeBeforeSessionEndMinutes ?? 0,
        maxInstrumentExposurePercent: botStatus.config.maxInstrumentExposurePercent ?? 0,
        maxTotalExposurePercent: botStatus.config.maxTotalExposurePercent ?? 0,
        dailyProfitTarget: botStatus.config.dailyProfitTarget ?? 0,
        equityFloor: botStatus.config.equityFloor ?? 0,
        maxWeeklyLossPercent: botStatus.config.maxWeeklyLossPercent ?? 5,
        maxConsecutiveLosses: botStatus.config.maxConsecutiveLosses ?? 6,
        reentryCooldownMinutes: botStatus.config.reentryCooldownMinutes ?? 5,
        onePositionPerInstrument: botStatus.config.onePositionPerInstrument ?? true,
        maxNetDirectionalPercent: botStatus.config.maxNetDirectionalPercent ?? 0,
        regimeFilterEnabled: botStatus.config.regimeFilterEnabled ?? true,
        barResolution: (botStatus.config.barResolution as BarResolution) ?? "MINUTE_5",
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

  // Broker connection — separate from bot config: this is the credentials
  // step every account needs before the bot (or any live data) can work at all.
  const { data: brokerStatus, isLoading: brokerStatusLoading } = useGetBrokerStatus({
    query: { queryKey: getGetBrokerStatusQueryKey() },
  });
  const [capitalApiKey, setCapitalApiKey] = useState("");
  const [capitalIdentifier, setCapitalIdentifier] = useState("");
  const [capitalPassword, setCapitalPassword] = useState("");
  const [t212ApiKey, setT212ApiKey] = useState("");
  const [t212ApiSecret, setT212ApiSecret] = useState("");

  // True once the user picks a different Active Broker than the one actually
  // connected — the radio buttons alone never switch anything, they just pick
  // which credential fields to show below.
  const isSwitchingBroker = Boolean(brokerStatus?.connected && brokerStatus.broker !== config.broker);

  const connectBroker = useConnectBroker({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBrokerStatusQueryKey() });
        setCapitalApiKey("");
        setCapitalIdentifier("");
        setCapitalPassword("");
        setT212ApiKey("");
        setT212ApiSecret("");
        toast({ title: "Broker connected" });
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Could not connect — check your credentials.";
        toast({ title: "Failed to connect broker", description: message, variant: "destructive" });
      },
    },
  });

  const disconnectBroker = useDisconnectBroker({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBrokerStatusQueryKey() });
        toast({ title: "Broker disconnected" });
      },
    },
  });

  const handleConnectBroker = (e: React.FormEvent) => {
    e.preventDefault();
    if (config.broker === "capitalcom") {
      connectBroker.mutate({
        data: { broker: "capitalcom", capital: { apiKey: capitalApiKey, identifier: capitalIdentifier, password: capitalPassword } },
      });
    } else {
      connectBroker.mutate({ data: { broker: "trading212", trading212: { apiKey: t212ApiKey, apiSecret: t212ApiSecret } } });
    }
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

      {/* Current plan + what it includes */}
      {planStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 flex-wrap">
              Your Plan
              <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary">
                {planStatus.plan}
              </span>
              {planStatus.plan !== "enterprise" && (
                <span className="ml-auto">
                  <RequestUpgradeButton trigger="plan_card" />
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {planStatus.limits.liveTrading
                ? "Your plan includes live trading."
                : "Your plan is research-only — backtests, charts, the scanner and the AI assistant all work, but the bot always simulates trades."}{" "}
              <Link href="/pricing" className="text-primary hover:underline" data-testid="link-compare-plans">
                Compare plans →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Live trading</div>
              <div className="mt-1 font-medium">{planStatus.limits.liveTrading ? "Included" : "Not included"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">AI trade modes</div>
              <div className="mt-1 font-medium">{planStatus.limits.aiTradeModes ? "Included" : "Not included"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Instruments</div>
              <div className="mt-1 font-medium font-mono">
                {planStatus.usage.instruments}
                {planStatus.limits.maxInstruments == null ? " / ∞" : ` / ${planStatus.limits.maxInstruments}`}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">AI requests today</div>
              <div className="mt-1 font-medium font-mono">
                {planStatus.usage.aiQueriesToday}
                {planStatus.limits.aiQueriesPerDay == null ? " / ∞" : ` / ${planStatus.limits.aiQueriesPerDay}`}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <ChangePasswordCard />

      {/* Broker connection — required before the bot or any live data can work */}
      <TradingModeSwitch />

      <CollapsibleSection
        id="settings.broker"
        title="Broker Connection"
        defaultOpen={false}
        description={<>Connect your own {BROKER_LABELS[config.broker]} account. Your credentials are encrypted and used only
            for your own bot — never shared with other accounts.</>}
        className={brokerStatus?.connected ? undefined : "border-amber-500/40"}
        contentClassName="space-y-4"
      >
          {brokerStatusLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : brokerStatus?.connected ? (
            <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-lg bg-muted/20">
              <div className="flex items-center gap-2 text-sm">
                <Link2 className="h-4 w-4 text-primary" />
                <span>
                  Connected to <span className="font-medium">{BROKER_LABELS[brokerStatus.broker ?? config.broker]}</span>
                  {brokerStatus.identifierMasked && <span className="text-muted-foreground"> ({brokerStatus.identifierMasked})</span>}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => disconnectBroker.mutate()}
                disabled={disconnectBroker.isPending}
                data-testid="button-disconnect-broker"
              >
                <Unlink className="mr-2 h-3.5 w-3.5" /> Disconnect
              </Button>
            </div>
          ) : (
            <p className="text-sm text-amber-500">No broker connected yet — the bot can't run until you connect one below.</p>
          )}

          {isSwitchingBroker && (
            <p className="text-sm text-amber-500">
              You're currently connected to {BROKER_LABELS[brokerStatus!.broker ?? "capitalcom"]}. Fill in your{" "}
              {BROKER_LABELS[config.broker]} details below and click Switch to replace it — only one broker can be
              connected at a time.
            </p>
          )}

          <form onSubmit={handleConnectBroker} className="space-y-3">
            {config.broker === "capitalcom" ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="capital-api-key">API Key</Label>
                  <Input
                    id="capital-api-key"
                    value={capitalApiKey}
                    onChange={(e) => setCapitalApiKey(e.target.value)}
                    required
                    data-testid="input-capital-api-key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capital-identifier">Identifier (email)</Label>
                  <Input
                    id="capital-identifier"
                    value={capitalIdentifier}
                    onChange={(e) => setCapitalIdentifier(e.target.value)}
                    required
                    data-testid="input-capital-identifier"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capital-password">Password</Label>
                  <Input
                    id="capital-password"
                    type="password"
                    value={capitalPassword}
                    onChange={(e) => setCapitalPassword(e.target.value)}
                    required
                    data-testid="input-capital-password"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="t212-api-key">API Key</Label>
                  <Input
                    id="t212-api-key"
                    value={t212ApiKey}
                    onChange={(e) => setT212ApiKey(e.target.value)}
                    required
                    data-testid="input-t212-api-key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t212-api-secret">API Secret</Label>
                  <Input
                    id="t212-api-secret"
                    type="password"
                    value={t212ApiSecret}
                    onChange={(e) => setT212ApiSecret(e.target.value)}
                    required
                    data-testid="input-t212-api-secret"
                  />
                  <p className="text-xs text-muted-foreground">
                    Trading 212 issues a key and a secret together (app → Settings → API). Both are required.
                  </p>
                </div>
              </div>
            )}
            <Button type="submit" disabled={connectBroker.isPending} data-testid="button-connect-broker">
              {connectBroker.isPending
                ? "Connecting…"
                : isSwitchingBroker
                  ? `Switch to ${BROKER_LABELS[config.broker]}`
                  : brokerStatus?.connected
                    ? "Reconnect"
                    : "Connect"}
            </Button>
          </form>
      </CollapsibleSection>

      {/* Engine status */}
      <CollapsibleSection
        id="settings.engine"
        title="Engine Status"
        className="border-primary/20"
        contentClassName="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
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
      </CollapsibleSection>

      {/* Admin mode */}
      <CollapsibleSection
        id="settings.adminMode"
        title="Admin Mode"
        defaultOpen={false}
        description={<>Unlocks admin-only controls such as generating the AI Daily Market Brief.
            This is a local toggle only and is not a security boundary.</>}
      >
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
      </CollapsibleSection>

      {/* AI trade mode */}
      <CollapsibleSection
        id="settings.aiMode"
        title="AI Trade Mode"
        defaultOpen={false}
        description={<>Choose how AI takes part in placing trades. Changes save with the button below.</>}
        contentClassName="space-y-3"
      >
          {aiModesLocked && (
            <div className="text-xs rounded-md p-3 border border-border bg-muted/30 text-muted-foreground flex items-center justify-between gap-3 flex-wrap">
              <span>
                AI trade modes aren't included in your plan — the bot uses the moving-average
                strategy on its own. Upgrade to Pro to let AI review or make trade decisions.
              </span>
              <RequestUpgradeButton trigger="ai_trade_modes" />
            </div>
          )}
          {AI_MODES.map((mode) => {
            // "off" stays available on every plan: it's the plain-strategy
            // default, not a paid feature.
            const modeLocked = aiModesLocked && mode.value !== "off";
            return (
            <button
              key={mode.value}
              type="button"
              disabled={modeLocked}
              data-testid={`button-ai-mode-${mode.value}`}
              onClick={() => setConfig({ ...config, aiTradeMode: mode.value })}
              className={[
                "w-full rounded-lg border px-4 py-3 text-left transition-all",
                modeLocked ? "opacity-50 cursor-not-allowed border-border bg-muted/10" :
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
            );
          })}
          {/* Conviction floor. Only meaningful when AI is in the loop, so it
              appears with the modes it governs rather than as a stray setting. */}
          {config.aiTradeMode !== "off" && (
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="min-ai-confidence">Minimum AI confidence to trade</Label>
              <Select
                value={config.minAiConfidence ?? "any"}
                onValueChange={(v) => setConfig({ ...config, minAiConfidence: v as typeof config.minAiConfidence })}
              >
                <SelectTrigger id="min-ai-confidence" data-testid="select-min-ai-confidence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any — trade on every AI decision</SelectItem>
                  <SelectItem value="medium">Medium or higher</SelectItem>
                  <SelectItem value="high">High only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The AI states how confident it is in each decision. "Any" acts on all of them,
                including the ones it flags as low conviction.
              </p>
            </div>
          )}

          {config.aiTradeMode !== "off" && (
            <div className="text-xs rounded-md p-3 border border-amber-500/40 bg-amber-500/10 text-amber-500">
              {config.dryRun
                ? "Dry Run is ON, so the AI's decisions are simulated only — no real orders are sent. Watch them here before going live."
                : "Dry Run is OFF — the AI's decisions will place REAL orders with real money. Turn Dry Run back on to test safely first."}
            </div>
          )}
      </CollapsibleSection>

      {/* Fast engine */}
      <CollapsibleSection
        id="settings.fastEngine"
        title="Fast Engine (Scalping)"
        defaultOpen={false}
        description={<>Trades short, frequent moves instead of holding for hours. Only worth running with the
            cost hurdle below — at this speed the spread is fixed while the move you capture shrinks.</>}
        contentClassName="space-y-4"
      >
          <div className="space-y-1.5">
            <Label htmlFor="strategy-mode">Strategy mode</Label>
            <Select
              value={config.strategyMode}
              onValueChange={(v) => setConfig({ ...config, strategyMode: v as StrategyMode })}
            >
              <SelectTrigger id="strategy-mode" data-testid="select-strategy-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Normal — trend / reversion by market regime</SelectItem>
                <SelectItem value="scalp">Fast — micro-reversion scalping</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Fast mode supports up to 20 instruments and needs a short Interval (1&ndash;5 minutes)
              to be worth running.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="min-edge">Required edge vs spread (&times;)</Label>
              <Input
                id="min-edge"
                type="number"
                step="0.5"
                min="0"
                value={config.minEdgeVsSpread}
                onChange={(e) => setConfig({ ...config, minEdgeVsSpread: Number(e.target.value) })}
                data-testid="input-min-edge"
              />
              <p className="text-xs text-muted-foreground">
                No trade unless the expected move is this many times the live spread. On a 0.045%
                spread, 3&times; means a move of 0.135% or nothing happens. 0 disables the check.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-trades-day">Max trades per day</Label>
              <Input
                id="max-trades-day"
                type="number"
                min="0"
                value={config.maxTradesPerDay}
                onChange={(e) => setConfig({ ...config, maxTradesPerDay: Number(e.target.value) })}
                data-testid="input-max-trades-day"
              />
              <p className="text-xs text-muted-foreground">Hard stop on churn. 0 = unlimited.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="max-intraday-dd">Max intraday drawdown (%)</Label>
            <Input
              id="max-intraday-dd"
              type="number"
              step="0.5"
              min="0"
              value={config.maxIntradayDrawdownPercent}
              onChange={(e) => setConfig({ ...config, maxIntradayDrawdownPercent: Number(e.target.value) })}
              data-testid="input-max-intraday-dd"
            />
            <p className="text-xs text-muted-foreground">
              Halts the engine after giving back this much from the day&rsquo;s <em>high</em> — tighter
              than Max Daily Loss, which only measures from the day&rsquo;s open. 0 disables.
            </p>
          </div>
      </CollapsibleSection>

      {/* Loss limits — the guards that bound what the account can lose */}
      <CollapsibleSection
        id="settings.lossLimits"
        title="Loss Limits"
        defaultOpen={false}
        description={
          <>
            What stops the bot. Each one halts trading and stays halted until you resume it — nothing here
            restarts on its own. Open positions keep the stop-loss and take-profit they were opened with,
            and can always be closed.
          </>
        }
        contentClassName="space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="equity-floor">Account floor (&pound;)</Label>
            <Input
              id="equity-floor"
              type="number"
              step="50"
              min="0"
              value={config.equityFloor}
              onChange={(e) => setConfig({ ...config, equityFloor: Number(e.target.value) })}
              data-testid="input-equity-floor"
            />
            <p className="text-xs text-muted-foreground">
              The bot stops if equity reaches this figure. Every other limit here is a percentage of a
              baseline that re-bases each day, so an account can fall a long way in small compliant steps —
              this is the only one that does not move. 0 disables it.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max-weekly-loss">Max weekly loss (%)</Label>
            <Input
              id="max-weekly-loss"
              type="number"
              step="0.5"
              min="0"
              value={config.maxWeeklyLossPercent}
              onChange={(e) => setConfig({ ...config, maxWeeklyLossPercent: Number(e.target.value) })}
              data-testid="input-max-weekly-loss"
            />
            <p className="text-xs text-muted-foreground">
              Measured from Monday&rsquo;s opening equity. Five days each losing 1.9% break no daily limit
              and still cost 9%. Resuming does <em>not</em> hand back a fresh weekly allowance. 0 disables.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max-consecutive-losses">Stop after losses in a row</Label>
            <Input
              id="max-consecutive-losses"
              type="number"
              min="0"
              value={config.maxConsecutiveLosses}
              onChange={(e) => setConfig({ ...config, maxConsecutiveLosses: Number(e.target.value) })}
              data-testid="input-max-consecutive-losses"
            />
            <p className="text-xs text-muted-foreground">
              Counted from your broker&rsquo;s own closed trades, so stop-losses count too. The earliest
              sign that conditions have turned — the limits above only notice once the money is gone.
              0 disables.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max-net-directional">Max net direction (%)</Label>
            <Input
              id="max-net-directional"
              type="number"
              step="1"
              min="0"
              value={config.maxNetDirectionalPercent}
              onChange={(e) => setConfig({ ...config, maxNetDirectionalPercent: Number(e.target.value) })}
              data-testid="input-max-net-directional"
            />
            <p className="text-xs text-muted-foreground">
              Longs minus shorts, as a share of the account. Your other caps look at one instrument at a
              time, so three separate shorts in gold and two US indices pass every limit while being, in
              substance, one bet that everything falls together. This is the limit that sees that. An order
              that <em>reduces</em> the imbalance is always allowed. 0 disables.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reentry-cooldown">Repeat-order cooldown (min)</Label>
            <Input
              id="reentry-cooldown"
              type="number"
              min="0"
              value={config.reentryCooldownMinutes}
              onChange={(e) => setConfig({ ...config, reentryCooldownMinutes: Number(e.target.value) })}
              data-testid="input-reentry-cooldown"
            />
            <p className="text-xs text-muted-foreground">
              How long before the <em>same instruction</em> can be sent for an instrument again — a second
              buy, or a second sell. Your broker takes a few seconds to report a fill, and in that gap the
              bot reads a position that no longer exists and acts on it twice. A buy followed by the sell
              that exits it is never delayed, because the side is different. 0 disables.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">One position per instrument</p>
            <p className="text-xs text-muted-foreground max-w-md">
              Refuses an order that would add to a position you already hold. With this off, a position can
              be built one compliant order at a time — which is how a 39-unit short reached about 80% of the
              account in September while breaking no limit at all.
            </p>
          </div>
          <Switch
            checked={config.onePositionPerInstrument}
            onCheckedChange={(checked) => setConfig({ ...config, onePositionPerInstrument: checked })}
            data-testid="switch-one-position-per-instrument"
          />
        </div>
      </CollapsibleSection>

      {/* Market regime filter */}
      <CollapsibleSection
        id="settings.regime"
        title="Market Regime Filter"
        defaultOpen={false}
        description={<>Automatically pick the right strategy per instrument based on market conditions.</>}
      >
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
      </CollapsibleSection>

      {/* Strategy config */}
      <CollapsibleSection
        id="settings.strategy"
        title="Strategy Configuration"
        defaultOpen={false}
        description={<>Moving Average Crossover — broker, periods, and trade size</>}
      >
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

            {/* Bar resolution — what the bot, scanner, and backtest all fetch signal bars at */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Bar Resolution</label>
              <Select
                value={config.barResolution}
                onValueChange={(v) => setConfig({ ...config, barResolution: v as BarResolution })}
              >
                <SelectTrigger data-testid="select-bar-resolution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOLUTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Candle size for signal calculation. The Scanner always uses this same resolution — there's no
                separate setting for it. Finer resolutions (1-5 min) suit day trading; hourly or longer suits
                swing trading.
              </p>
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
                  <label className="text-sm font-medium">Max Exposure Per Instrument (%)</label>
                  <Input
                    type="number"
                    value={config.maxInstrumentExposurePercent}
                    onChange={(e) => setConfig({ ...config, maxInstrumentExposurePercent: Number(e.target.value) })}
                    className="font-mono"
                    min={0} max={100} step={1}
                    data-testid="input-max-instrument-exposure"
                  />
                  <p className="text-xs text-muted-foreground">
                    {config.maxInstrumentExposurePercent > 0
                      ? `Everything held in one instrument, long and short together, may not exceed ${config.maxInstrumentExposurePercent}% of the account.`
                      : "No limit on how much of the account one instrument can become (not recommended)."}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Total Exposure (%)</label>
                  <Input
                    type="number"
                    value={config.maxTotalExposurePercent}
                    onChange={(e) => setConfig({ ...config, maxTotalExposurePercent: Number(e.target.value) })}
                    className="font-mono"
                    min={0} step={1}
                    data-testid="input-max-total-exposure"
                  />
                  <p className="text-xs text-muted-foreground">
                    {config.maxTotalExposurePercent > 0
                      ? `Everything held across all instruments may not exceed ${config.maxTotalExposurePercent}% of the account.`
                      : "No limit on total exposure (not recommended)."}
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

            <div className="space-y-4 pt-2">
              <div>
                <p className="text-sm font-medium">Protecting your day</p>
                <p className="text-xs text-muted-foreground">
                  Both are off at 0. Neither creates profit; they limit how a day can go wrong.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="close-before-end" className="text-sm font-medium">
                    Close before market close (minutes)
                  </label>
                  <Input
                    id="close-before-end"
                    type="number"
                    value={config.closeBeforeSessionEndMinutes}
                    onChange={(e) => setConfig({ ...config, closeBeforeSessionEndMinutes: Number(e.target.value) })}
                    className="font-mono"
                    min={0}
                    max={120}
                    step={1}
                    data-testid="input-close-before-session-end"
                  />
                  <p className="text-xs text-muted-foreground">
                    Closes positions this long before a market shuts overnight or for the weekend, so nothing
                    is held through the gap — where a price can jump past your stop-loss. Also stops new
                    positions that close to the bell. Short daily pauses don&rsquo;t count.
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="daily-profit-target" className="text-sm font-medium">
                    Daily profit target
                  </label>
                  <Input
                    id="daily-profit-target"
                    type="number"
                    value={config.dailyProfitTarget}
                    onChange={(e) => setConfig({ ...config, dailyProfitTarget: Number(e.target.value) })}
                    className="font-mono"
                    min={0}
                    step={1}
                    data-testid="input-daily-profit-target"
                  />
                  <p className="text-xs text-muted-foreground">
                    Once the account is up this much on the day, no new positions until tomorrow (UTC) — so a
                    good day isn&rsquo;t given back. Open positions keep their exits and can still close.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/20">
              <div className="space-y-0.5 pr-4">
                <label className="text-sm font-medium">Dry Run Mode</label>
                <div className="text-xs text-muted-foreground">
                  {liveTradingLocked
                    ? "Your plan is research-only, so the bot always simulates trades. Upgrade to place real orders."
                    : `Log signals without executing real trades on ${BROKER_LABELS[config.broker]}`}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {liveTradingLocked && <RequestUpgradeButton trigger="live_trading" />}
                <Switch
                  checked={liveTradingLocked ? true : config.dryRun}
                  disabled={liveTradingLocked}
                  onCheckedChange={(checked) => setConfig({ ...config, dryRun: checked })}
                  data-testid="switch-dry-run"
                />
              </div>
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
      </CollapsibleSection>
    </div>
  );
}
