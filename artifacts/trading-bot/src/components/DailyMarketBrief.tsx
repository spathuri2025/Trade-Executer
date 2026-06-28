import {
  useGetLatestDailyBrief,
  getGetLatestDailyBriefQueryKey,
  useCreateDailyBrief,
} from "@workspace/api-client-react";
import type { MarketUpdate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAdminMode } from "@/hooks/use-admin-mode";
import { Sparkles, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";

/* ── design tokens (match dashboard) ── */
const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";
const mutedLo = "hsl(var(--muted-foreground) / 0.7)";
const emerald = "#10b981";
const red = "#f87171";
const amber = "#d97706";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

function biasTone(bias: string): { color: string; Icon: typeof TrendingUp; label: string } {
  // The model returns "<bias label> — <explanation>". Only inspect the leading
  // label segment so words inside the explanation (e.g. "shorter timeframes")
  // can't flip the tone.
  const lead = bias.split(/[—\-:.]/)[0]?.toLowerCase() ?? bias.toLowerCase();
  if (/bull|positive|upside/.test(lead)) return { color: emerald, Icon: TrendingUp, label: "Bullish" };
  if (/bear|negative|downside/.test(lead)) return { color: red, Icon: TrendingDown, label: "Bearish" };
  return { color: amber, Icon: Minus, label: "Neutral" };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <SectionLabel>{label}</SectionLabel>
      <p className="text-sm leading-relaxed" style={{ color: "hsl(var(--foreground) / 0.85)" }}>
        {value || "—"}
      </p>
    </div>
  );
}

function MarketCard({ market }: { market: MarketUpdate }) {
  const { color, Icon, label } = biasTone(market.bias);
  return (
    <div className="rounded-lg overflow-hidden flex flex-col" style={{ backgroundColor: card, border: cardBorder }}>
      <div className="flex items-center justify-between gap-3 p-5" style={{ borderBottom: divider }}>
        <h3 className="text-base font-medium">{market.name}</h3>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold tracking-wide shrink-0"
          style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}3d` }}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
      </div>

      <div className="p-5 space-y-4">
        <Field label="Market Bias" value={market.bias} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Key Support" value={market.support} />
          <Field label="Key Resistance" value={market.resistance} />
        </div>
        <Field label="News / Events" value={market.news} />
        <Field label="High-Risk Periods" value={market.highRiskPeriods} />
        <Field label="Technical Observations" value={market.technicalObservations} />
        <Field label="Educational Summary" value={market.educationalSummary} />
      </div>
    </div>
  );
}

export default function DailyMarketBrief() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAdmin } = useAdminMode();

  const { data, isLoading } = useGetLatestDailyBrief({
    query: { queryKey: getGetLatestDailyBriefQueryKey() },
  });

  const createBrief = useCreateDailyBrief({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLatestDailyBriefQueryKey() });
        toast({ title: "Today's brief generated" });
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast({ title: "Failed to generate brief", description: message, variant: "destructive" });
      },
    },
  });

  const brief = data?.brief ?? null;
  const generatedAt = brief ? new Date(brief.createdAt) : null;

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4" style={{ color: amber }} />
          <SectionLabel>AI Daily Market Brief</SectionLabel>
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
            onClick={() => createBrief.mutate()}
            disabled={createBrief.isPending}
            data-testid="button-generate-brief"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${createBrief.isPending ? "animate-spin" : ""}`} />
            {createBrief.isPending ? "Generating…" : "Generate Today's Brief"}
          </Button>
        )}
      </div>

      {/* User-facing card: Today's AI Market Update */}
      <div className="rounded-lg p-6 space-y-1" style={{ backgroundColor: card, border: cardBorder }}>
        <h2 className="text-lg font-light tracking-tight">Today's AI Market Update</h2>
        <p className="text-sm" style={{ color: muted }}>
          AI-generated technical outlook for Crude Oil WTI, Gold, S&amp;P 500 and Bitcoin — refreshed daily.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-lg" />
          ))}
        </div>
      ) : !brief || brief.markets.length === 0 ? (
        <div
          className="rounded-lg p-8 text-center text-sm"
          style={{ backgroundColor: card, border: cardBorder, color: muted }}
        >
          {createBrief.isPending
            ? "Generating today's market brief…"
            : isAdmin
              ? "No brief yet. Use \u201CGenerate Today's Brief\u201D to create the first one."
              : "Today's market brief hasn't been published yet. Please check back soon."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {brief.markets.map((m) => (
              <MarketCard key={m.name} market={m} />
            ))}
          </div>

          {/* Disclaimer */}
          <p
            className="text-xs leading-relaxed rounded-lg p-4"
            style={{ color: mutedLo, backgroundColor: "hsl(var(--accent) / 0.4)", border: divider }}
          >
            {brief.disclaimer}
          </p>
        </>
      )}
    </section>
  );
}
