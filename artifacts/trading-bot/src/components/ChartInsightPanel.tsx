import {
  useGetChartInsight,
  getGetChartInsightQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, TrendingUp, TrendingDown, MoveHorizontal } from "lucide-react";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";
const mutedLo = "hsl(var(--muted-foreground) / 0.7)";
const emerald = "#10b981";
const red = "#f87171";
const amber = "#d97706";
const sky = "#38bdf8";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

function trendTone(trend: string) {
  if (trend === "Uptrend") return { color: emerald, Icon: TrendingUp };
  if (trend === "Downtrend") return { color: red, Icon: TrendingDown };
  return { color: sky, Icon: MoveHorizontal };
}

function volColor(v: string) {
  return v === "High" ? red : v === "Medium" ? amber : emerald;
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>{label}</div>
      <div className="text-sm font-mono font-medium mt-0.5" style={{ color: color ?? "inherit" }}>{value}</div>
    </div>
  );
}

export default function ChartInsightPanel({ epic, resolution }: { epic: string; resolution: string }) {
  const { data, isLoading, isError } = useGetChartInsight(
    { epic, resolution },
    {
      query: {
        queryKey: getGetChartInsightQueryKey({ epic, resolution }),
        enabled: !!epic,
        staleTime: 60_000,
      },
    },
  );

  return (
    <div
      style={{
        background: card,
        border: cardBorder,
        borderRadius: 14,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" style={{ color: amber }} />
        <SectionLabel>AI Technical Read</SectionLabel>
      </div>

      {!epic ? (
        <p className="text-sm" style={{ color: muted }}>Select an instrument to see the AI read.</p>
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError || !data ? (
        <p className="text-sm" style={{ color: muted }}>
          Couldn't compute an AI read for this instrument right now.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            {(() => {
              const { color, Icon } = trendTone(data.trend);
              return (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
                  style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}3d` }}
                >
                  <Icon className="h-4 w-4" />
                  {data.trend}
                </div>
              );
            })()}
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 rounded-full overflow-hidden" style={{ backgroundColor: "hsl(var(--border))" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, data.confidence))}%`, backgroundColor: sky }} />
              </div>
              <span className="text-xs font-mono tabular-nums" style={{ color: mutedLo }}>
                {data.confidence}% conf.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-1" style={{ borderTop: divider, paddingTop: 12 }}>
            <Metric label="Support" value={data.support != null ? data.support.toFixed(2) : "—"} color={emerald} />
            <Metric label="Resistance" value={data.resistance != null ? data.resistance.toFixed(2) : "—"} color={red} />
            <Metric label="Volatility" value={data.volatility} color={volColor(data.volatility)} />
          </div>

          <p className="text-sm leading-relaxed" style={{ color: "hsl(var(--foreground) / 0.9)" }}>
            {data.explanation}
          </p>

          <p
            className="text-xs leading-relaxed rounded-lg p-3"
            style={{ color: mutedLo, backgroundColor: "hsl(var(--accent) / 0.4)", border: divider }}
          >
            {data.riskWarning}
          </p>
        </>
      )}
    </div>
  );
}
