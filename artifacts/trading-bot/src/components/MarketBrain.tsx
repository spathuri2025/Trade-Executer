import {
  useGetLatestMarketBrain,
  getGetLatestMarketBrainQueryKey,
  useGenerateMarketBrain,
} from "@workspace/api-client-react";
import type { MarketBrainSnapshot } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAdminMode } from "@/hooks/use-admin-mode";
import {
  BrainCircuit,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Zap,
  Newspaper,
  CalendarClock,
  Target,
  AlertTriangle,
} from "lucide-react";

/* ── design tokens (match dashboard) ── */
const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";
const mutedLo = "hsl(var(--muted-foreground) / 0.7)";
const emerald = "#10b981";
const red = "#f87171";
const amber = "#d97706";
const sky = "#38bdf8";
const violet = "#a78bfa";

function isFromToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

type RegimeTone = { color: string; Icon: typeof TrendingUp };

function regimeTone(regime: string): RegimeTone {
  switch (regime) {
    case "Risk-On":
      return { color: emerald, Icon: TrendingUp };
    case "Risk-Off":
      return { color: red, Icon: TrendingDown };
    case "High Volatility":
      return { color: amber, Icon: Zap };
    default:
      return { color: sky, Icon: BrainCircuit };
  }
}

function ConfidenceBar({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full overflow-hidden" style={{ backgroundColor: "hsl(var(--border))" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono tabular-nums" style={{ color: mutedLo }}>
        {pct}%
      </span>
    </div>
  );
}

function importanceColor(importance: string): string {
  return importance === "high" ? red : importance === "medium" ? amber : mutedLo;
}

function MiniStat({
  Icon,
  label,
  value,
  color,
}: {
  Icon: typeof TrendingUp;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-4 py-3" style={{ backgroundColor: "hsl(var(--accent) / 0.4)", border: divider }}>
      <Icon className="h-4 w-4 shrink-0" style={{ color }} />
      <div className="min-w-0">
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>{label}</div>
        <div className="text-sm font-medium mt-0.5 truncate">{value}</div>
      </div>
    </div>
  );
}

function BrainBody({ snapshot }: { snapshot: MarketBrainSnapshot }) {
  const { color, Icon } = regimeTone(snapshot.regime);
  return (
    <div className="rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
      {/* Regime header */}
      <div className="flex items-center justify-between gap-4 px-6 py-5 flex-wrap" style={{ borderBottom: divider }}>
        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold tracking-wide"
            style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}3d` }}
          >
            <Icon className="h-4 w-4" />
            {snapshot.regime}
          </div>
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>
              Regime confidence
            </div>
            <div className="mt-1">
              <ConfidenceBar value={snapshot.confidence} color={color} />
            </div>
          </div>
        </div>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-6" style={{ borderBottom: divider }}>
        <MiniStat
          Icon={Newspaper}
          label="High-impact news"
          value={`${snapshot.highImpactNewsCount} flagged`}
          color={snapshot.highImpactNewsCount > 0 ? amber : muted}
        />
        <MiniStat
          Icon={CalendarClock}
          label="Upcoming events"
          value={`${snapshot.upcomingEvents.length} on watch`}
          color={sky}
        />
      </div>

      {/* Drivers */}
      {snapshot.drivers.length > 0 && (
        <div className="p-6 space-y-3" style={{ borderBottom: divider }}>
          <SectionLabel>What's driving the market</SectionLabel>
          <div className="space-y-2.5">
            {snapshot.drivers.map((d, i) => (
              <div key={i} className="flex gap-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <div>
                  <div className="text-sm font-medium">{d.title}</div>
                  <div className="text-xs mt-0.5 leading-relaxed" style={{ color: mutedLo }}>{d.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Opportunities + Risks */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="p-6 space-y-3" style={{ borderBottom: divider }}>
          <div className="flex items-center gap-2">
            <Target className="h-3.5 w-3.5" style={{ color: emerald }} />
            <SectionLabel>Opportunities</SectionLabel>
          </div>
          {snapshot.opportunities.length > 0 ? (
            <div className="space-y-2.5">
              {snapshot.opportunities.map((o, i) => (
                <div key={i}>
                  <span className="text-sm font-medium" style={{ color: emerald }}>{o.asset}</span>
                  <span className="text-xs ml-2" style={{ color: mutedLo }}>{o.rationale}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs" style={{ color: muted }}>None flagged.</p>
          )}
        </div>

        <div className="p-6 space-y-3 lg:border-l" style={{ borderBottom: divider, borderColor: "hsl(var(--border))" }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" style={{ color: red }} />
            <SectionLabel>Risks</SectionLabel>
          </div>
          {snapshot.risks.length > 0 ? (
            <div className="space-y-2.5">
              {snapshot.risks.map((r, i) => (
                <div key={i}>
                  <div className="text-sm font-medium" style={{ color: red }}>{r.title}</div>
                  <div className="text-xs mt-0.5 leading-relaxed" style={{ color: mutedLo }}>{r.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs" style={{ color: muted }}>None flagged.</p>
          )}
        </div>
      </div>

      {/* Upcoming events */}
      {snapshot.upcomingEvents.length > 0 && (
        <div className="p-6 space-y-3" style={{ borderBottom: divider }}>
          <SectionLabel>Upcoming events</SectionLabel>
          <div className="space-y-2">
            {snapshot.upcomingEvents.map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: importanceColor(e.importance) }}
                  />
                  <span className="text-sm truncate">{e.name}</span>
                </div>
                <span className="text-xs tabular-nums shrink-0" style={{ color: mutedLo }}>{e.when}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-xs leading-relaxed p-4" style={{ color: mutedLo, backgroundColor: "hsl(var(--accent) / 0.4)" }}>
        {snapshot.disclaimer}
      </p>
    </div>
  );
}

export default function MarketBrain() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAdmin } = useAdminMode();

  const { data, isLoading } = useGetLatestMarketBrain({
    query: {
      queryKey: getGetLatestMarketBrainQueryKey(),
      // The server self-populates in the background on first request, so keep
      // polling until we actually have today's snapshot, then stop.
      refetchInterval: (query) => {
        const s = query.state.data?.snapshot;
        return s && isFromToday(s.createdAt) ? false : 5000;
      },
    },
  });

  const generate = useGenerateMarketBrain({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLatestMarketBrainQueryKey() });
        toast({ title: "Market Brain refreshed" });
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast({ title: "Failed to refresh Market Brain", description: message, variant: "destructive" });
      },
    },
  });

  const snapshot = data?.snapshot ?? null;
  const generatedAt = snapshot ? new Date(snapshot.createdAt) : null;

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <BrainCircuit className="h-4 w-4" style={{ color: violet }} />
          <SectionLabel>AI Market Brain</SectionLabel>
          {generatedAt && (
            <span className="text-xs tabular-nums" style={{ color: mutedLo }}>
              · {generatedAt.toLocaleDateString([], { day: "numeric", month: "short" })}{" "}
              {generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            data-testid="button-generate-market-brain"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${generate.isPending ? "animate-spin" : ""}`} />
            {generate.isPending ? "Analysing…" : "Refresh Brain"}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : !snapshot ? (
        <div
          className="rounded-lg p-8 text-center text-sm"
          style={{ backgroundColor: card, border: cardBorder, color: muted }}
        >
          {generate.isPending
            ? "Analysing market conditions…"
            : "Preparing the market read… this can take a few seconds. It will appear here automatically."}
        </div>
      ) : (
        <BrainBody snapshot={snapshot} />
      )}
    </section>
  );
}
