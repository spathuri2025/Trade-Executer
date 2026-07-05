import {
  useGetPerformanceCoach,
  getGetPerformanceCoachQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck } from "lucide-react";

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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>{label}</div>
      <div className="text-sm font-mono mt-0.5" style={{ color: color ?? "inherit" }}>{value}</div>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 70) return emerald;
  if (score >= 40) return amber;
  return red;
}

const money = (n: number) => `${n >= 0 ? "+" : ""}£${n.toFixed(2)}`;

export default function PerformanceCoach() {
  const { data, isLoading, isError } = useGetPerformanceCoach({
    query: {
      queryKey: getGetPerformanceCoachQueryKey(),
      staleTime: 60_000,
    },
  });

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <GraduationCap className="h-4 w-4" style={{ color: amber }} />
        <SectionLabel>AI Performance Coach</SectionLabel>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : isError || !data ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          Couldn't load your performance coaching right now.
        </div>
      ) : data.closedTrades === 0 ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          No closed round-trips yet. Once you have completed trades, the coach will analyse your behaviour here.
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
          {/* Discipline score header */}
          <div className="flex items-center justify-between gap-4 px-6 py-5 flex-wrap" style={{ borderBottom: divider }}>
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5" style={{ color: scoreColor(data.riskDisciplineScore) }} />
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>
                  Risk discipline score
                </div>
                <div className="text-2xl font-mono font-medium mt-0.5" style={{ color: scoreColor(data.riskDisciplineScore) }}>
                  {data.riskDisciplineScore}
                  <span className="text-sm" style={{ color: mutedLo }}> / 100</span>
                </div>
              </div>
            </div>
            {data.overtradingWarning && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs max-w-sm"
                style={{ color: amber, backgroundColor: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.3)" }}
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {data.overtradingWarning}
              </div>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-6" style={{ borderBottom: divider }}>
            <Stat label="Closed trades" value={String(data.closedTrades)} />
            <Stat label="Win rate" value={data.winRate != null ? `${data.winRate.toFixed(0)}%` : "—"} />
            <Stat label="Avg win" value={data.avgWin != null ? money(data.avgWin) : "—"} color={emerald} />
            <Stat label="Avg loss" value={data.avgLoss != null ? money(data.avgLoss) : "—"} color={red} />
          </div>

          {/* Best / worst instrument */}
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <div className="p-6 space-y-2" style={{ borderBottom: divider }}>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5" style={{ color: emerald }} />
                <SectionLabel>Best instrument</SectionLabel>
              </div>
              {data.bestInstrument ? (
                <div>
                  <span className="text-sm font-medium">{data.bestInstrument.ticker}</span>
                  <span className="text-sm font-mono ml-2" style={{ color: emerald }}>{money(data.bestInstrument.netPnl)}</span>
                  <span className="text-xs ml-2" style={{ color: mutedLo }}>({data.bestInstrument.trades} trades)</span>
                </div>
              ) : (
                <p className="text-xs" style={{ color: muted }}>—</p>
              )}
            </div>
            <div className="p-6 space-y-2 sm:border-l" style={{ borderBottom: divider, borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center gap-2">
                <TrendingDown className="h-3.5 w-3.5" style={{ color: red }} />
                <SectionLabel>Worst instrument</SectionLabel>
              </div>
              {data.worstInstrument ? (
                <div>
                  <span className="text-sm font-medium">{data.worstInstrument.ticker}</span>
                  <span className="text-sm font-mono ml-2" style={{ color: red }}>{money(data.worstInstrument.netPnl)}</span>
                  <span className="text-xs ml-2" style={{ color: mutedLo }}>({data.worstInstrument.trades} trades)</span>
                </div>
              ) : (
                <p className="text-xs" style={{ color: muted }}>—</p>
              )}
            </div>
          </div>

          {/* AI suggestion */}
          <div className="p-6 space-y-2" style={{ borderBottom: divider }}>
            <SectionLabel>Suggested improvement</SectionLabel>
            <p className="text-sm leading-relaxed" style={{ color: "hsl(var(--foreground) / 0.9)" }}>
              {data.suggestedImprovement}
            </p>
          </div>

          {/* Disclaimer */}
          <p className="text-xs leading-relaxed p-4" style={{ color: mutedLo, backgroundColor: "hsl(var(--accent) / 0.4)" }}>
            {data.disclaimer}
          </p>
        </div>
      )}
    </section>
  );
}
