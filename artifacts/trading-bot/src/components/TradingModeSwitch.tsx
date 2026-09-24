import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTradingProfiles,
  getListTradingProfilesQueryKey,
  useActivateTradingProfile,
  useSaveTradingProfile,
  useGetBotStatus,
  getGetBotStatusQueryKey,
  useListPositions,
  getListPositionsQueryKey,
  type TradingProfile,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Check, Zap, Clock } from "lucide-react";

/**
 * One-click switching between trading modes.
 *
 * Changing mode by hand meant editing six fields; twice in one morning a value
 * landed as 0, which silently disables a control rather than tightening it.
 * The preview below exists for the same reason: the change is shown before it
 * is applied.
 */

const AI_LABEL: Record<string, string> = {
  off: "Strategy only",
  guard: "AI safety check",
  autonomous: "AI decides",
};

const BARS: Record<string, string> = {
  MINUTE: "1 min",
  MINUTE_5: "5 min",
  MINUTE_15: "15 min",
  MINUTE_30: "30 min",
  HOUR: "1 hour",
  HOUR_4: "4 hour",
  DAY: "1 day",
  WEEK: "1 week",
};

interface Change {
  label: string;
  from: string;
  to: string;
}

/** What applying this profile would change about the settings in force. */
export interface CurrentSettings {
  strategyMode?: string;
  barResolution?: string;
  intervalMinutes?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  minEdgeVsSpread?: number;
  aiTradeMode?: string;
  minAiConfidence?: string;
}

export function describeChanges(current: CurrentSettings, p: TradingProfile): Change[] {
  // Newer settings are optional in the API type (they were added after the
  // schema was first published), so an older server can answer without them.
  const config = {
    strategyMode: current.strategyMode ?? "auto",
    barResolution: current.barResolution ?? "MINUTE_5",
    intervalMinutes: current.intervalMinutes ?? 0,
    stopLossPercent: current.stopLossPercent ?? 0,
    takeProfitPercent: current.takeProfitPercent ?? 0,
    minEdgeVsSpread: current.minEdgeVsSpread ?? 0,
    aiTradeMode: current.aiTradeMode ?? "off",
    minAiConfidence: current.minAiConfidence ?? "any",
  };
  const rows: Change[] = [
    { label: "Strategy", from: config.strategyMode === "scalp" ? "Fast (scalp)" : "Auto", to: p.strategyMode === "scalp" ? "Fast (scalp)" : "Auto" },
    { label: "Bars", from: BARS[config.barResolution] ?? config.barResolution, to: BARS[p.barResolution] ?? p.barResolution },
    { label: "Cycle", from: `${config.intervalMinutes} min`, to: `${p.intervalMinutes} min` },
    { label: "Stop-loss", from: `${config.stopLossPercent}%`, to: `${p.stopLossPercent}%` },
    { label: "Take-profit", from: config.takeProfitPercent === 0 ? "off" : `${config.takeProfitPercent}%`, to: p.takeProfitPercent === 0 ? "off" : `${p.takeProfitPercent}%` },
    { label: "AI", from: AI_LABEL[config.aiTradeMode] ?? config.aiTradeMode, to: AI_LABEL[p.aiTradeMode] ?? p.aiTradeMode },
  ];
  if (p.strategyMode === "scalp" || config.strategyMode === "scalp") {
    rows.push({ label: "Cost hurdle", from: `${config.minEdgeVsSpread}× spread`, to: `${p.minEdgeVsSpread}× spread` });
  }
  return rows.filter((r) => r.from !== r.to);
}

export function TradingModeSwitch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState<TradingProfile | null>(null);

  const { data, isLoading } = useListTradingProfiles({
    query: { queryKey: getListTradingProfilesQueryKey() },
  });
  const { data: status } = useGetBotStatus({ query: { queryKey: getGetBotStatusQueryKey() } });
  const { data: positions } = useListPositions({ query: { queryKey: getListPositionsQueryKey(), retry: false } });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListTradingProfilesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
  };

  const activate = useActivateTradingProfile({
    mutation: {
      onSuccess: (r) => {
        setPending(null);
        refresh();
        toast({ title: `${r.name} mode is on`, description: "The bot picked it up on its next cycle." });
      },
      onError: (err) => {
        const message = (err as { data?: { error?: string } })?.data?.error ?? "Couldn't switch mode.";
        toast({ title: "Mode not changed", description: message, variant: "destructive" });
      },
    },
  });

  const save = useSaveTradingProfile({
    mutation: {
      onSuccess: (p) => {
        refresh();
        toast({ title: `Saved into ${p.name}`, description: "This mode now holds your current settings." });
      },
      onError: () => toast({ title: "Couldn't save into this mode", variant: "destructive" }),
    },
  });

  if (isLoading || !data) return <Skeleton className="h-24 w-full rounded-lg" />;

  const activeId = data.activeProfileId;
  const active = data.profiles.find((p) => p.id === activeId) ?? null;
  const openPositions = positions?.length ?? 0;
  const changes = pending && status ? describeChanges(status.config, pending) : [];

  return (
    <div className="rounded-lg border border-border p-4 space-y-4" data-testid="trading-mode-switch">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">Trading mode</p>
          <p className="text-xs text-muted-foreground">
            {active ? `${active.name} is on.` : "No mode applied — your settings are custom."} Switching changes how the bot
            trades. Your risk limits never change with it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.profiles.map((p) => {
            const isActive = p.id === activeId;
            return (
              <Button
                key={p.id}
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={() => setPending(isActive ? null : p)}
                disabled={activate.isPending}
                data-testid={`mode-${p.name.toLowerCase()}`}
              >
                {p.strategyMode === "scalp" ? <Zap className="h-3.5 w-3.5 mr-1.5" /> : <Clock className="h-3.5 w-3.5 mr-1.5" />}
                {p.name}
                {isActive && <Check className="h-3.5 w-3.5 ml-1.5" />}
              </Button>
            );
          })}
        </div>
      </div>

      {pending && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3" data-testid="mode-preview">
          <p className="text-sm font-medium">Switch to {pending.name}?</p>

          {changes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Your settings already match this mode. Nothing would change.</p>
          ) : (
            <div className="space-y-1">
              {changes.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-muted-foreground w-24 shrink-0">{c.label}</span>
                  <span className="text-muted-foreground line-through">{c.from}</span>
                  <span>→</span>
                  <span className="text-primary">{c.to}</span>
                </div>
              ))}
            </div>
          )}

          {openPositions > 0 && (
            <p className="flex items-start gap-2 text-xs text-amber-500">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              You have {openPositions} open position{openPositions === 1 ? "" : "s"}. They keep the stop-loss and take-profit
              they were opened with — those sit at the broker — but from now on the new mode&rsquo;s strategy decides when to
              close them. Close them first if you&rsquo;d rather start clean.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => activate.mutate({ id: pending.id })} disabled={activate.isPending} data-testid="confirm-mode">
              {activate.isPending ? "Switching…" : `Switch to ${pending.name}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={activate.isPending}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {active && !pending && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => save.mutate({ id: active.id })}
          disabled={save.isPending}
          data-testid="save-into-mode"
        >
          {save.isPending ? "Saving…" : `Save current settings into ${active.name}`}
        </Button>
      )}
    </div>
  );
}
