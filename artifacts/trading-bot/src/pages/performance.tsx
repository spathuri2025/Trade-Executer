import { useMemo, useState } from "react";
import {
  useGetBacktest,
  getGetBacktestQueryKey,
  type BacktestResult,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import PerformanceCoach from "@/components/PerformanceCoach";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const muted = "hsl(var(--muted-foreground))";

const STRATEGY_LABEL: Record<string, string> = {
  trend_following: "Trend-following",
  mean_reversion: "Mean-reversion",
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "text-primary" : tone === "neg" ? "text-destructive" : "";
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>{label}</div>
      <div className={`text-sm font-mono mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

type BacktestRow = BacktestResult;

function EquityCurve({ data }: { data: BacktestRow["equityCurve"] }) {
  const positive = data.length > 0 && data[data.length - 1].equity >= data[0].equity;
  const stroke = positive ? "hsl(var(--primary))" : "hsl(var(--destructive))";
  const id = useMemo(() => `eq-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div style={{ width: "100%", height: 120 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="i" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: cardBorder,
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: muted }}
            formatter={(v: number | string) => [Number(v).toFixed(0), "Equity"]}
            labelFormatter={(l) => `Bar ${l}`}
          />
          <Area type="monotone" dataKey="equity" stroke={stroke} strokeWidth={1.5} fill={`url(#${id})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ResultCard({ row }: { row: BacktestRow }) {
  return (
    <div className="p-5 rounded-lg" style={{ backgroundColor: card, border: cardBorder }}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="font-semibold">{row.ticker}</div>
          <div className="text-xs mt-0.5" style={{ color: muted }}>{row.name}</div>
        </div>
        <Badge
          variant="outline"
          className={
            row.strategy === "mean_reversion"
              ? "text-violet-400 border-violet-400/40 bg-violet-400/10"
              : "text-sky-400 border-sky-400/40 bg-sky-400/10"
          }
        >
          {STRATEGY_LABEL[row.strategy] ?? row.strategy}
        </Badge>
      </div>

      {row.totalTrades === 0 ? (
        <div className="text-xs py-6 text-center" style={{ color: muted }}>
          No trades triggered over the last {row.bars} bars.
        </div>
      ) : (
        <>
          <EquityCurve data={row.equityCurve} />

          {/* Edge / expectancy — the headline "is this strategy profitable?" metric */}
          <div
            className="flex items-center justify-between rounded-lg px-3 py-2.5 mt-4"
            style={{
              backgroundColor: row.expectancyPct > 0 ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
              border: `1px solid ${row.expectancyPct > 0 ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
            }}
          >
            <div>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>
                Expectancy / trade
              </div>
              <div className={`text-base font-mono font-semibold mt-0.5 ${row.expectancyPct > 0 ? "text-primary" : "text-destructive"}`}>
                {signedPct(row.expectancyPct)}
              </div>
            </div>
            <Badge
              variant="outline"
              className={
                row.expectancyPct > 0
                  ? "text-primary border-primary/40 bg-primary/10"
                  : "text-destructive border-destructive/40 bg-destructive/10"
              }
            >
              {row.expectancyPct > 0 ? "Positive edge" : "No edge"}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4">
            <Stat label="Total Return" value={signedPct(row.totalReturnPct)} tone={row.totalReturnPct >= 0 ? "pos" : "neg"} />
            <Stat label="Win Rate" value={pct(row.winRate)} />
            <Stat label="Profit Factor" value={row.profitFactor == null ? "∞" : row.profitFactor.toFixed(2)} tone={row.profitFactor != null && row.profitFactor >= 1 ? "pos" : row.profitFactor == null ? "pos" : "neg"} />
            <Stat label="Avg Win" value={signedPct(row.avgWinPct)} tone="pos" />
            <Stat label="Avg Loss" value={signedPct(row.avgLossPct)} tone="neg" />
            <Stat label="Max Drawdown" value={pct(row.maxDrawdownPct)} tone="neg" />
            <Stat label="Trades" value={String(row.totalTrades)} />
          </div>
        </>
      )}
    </div>
  );
}

export default function Performance() {
  const [enabled, setEnabled] = useState(false);
  const { data, isFetching, isError, refetch } = useGetBacktest({
    query: {
      queryKey: getGetBacktestQueryKey(),
      enabled,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60_000,
    },
  });

  const run = () => {
    setEnabled(true);
    if (enabled) refetch();
  };

  return (
    <div className="space-y-6 md:space-y-8">
      {/* ── AI Performance Coach (behavioural analysis of real trade history) ── */}
      <PerformanceCoach />

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-4xl font-light tracking-tight">Strategy Performance</h1>
          <p className="text-sm mt-2 max-w-2xl" style={{ color: muted }}>
            A deterministic backtest of both strategies over recent price history for each tracked
            instrument. This is your evidence for whether a strategy is actually working — review it
            before turning on any live automation. All numbers are computed in code, not by AI.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={isFetching}
          data-testid="button-run-backtest"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {isFetching ? "Running…" : enabled ? "Re-run backtest" : "Run backtest"}
        </button>
      </div>

      {data && (
        <p className="text-xs" style={{ color: muted }}>
          {data.results.length > 0
            ? `${data.broker} · MA ${data.shortPeriod}/${data.longPeriod} · up to ${data.historyBars} bars · cost/trade ${(data.costPct * 100).toFixed(2)}% · generated ${new Date(data.generatedAt).toLocaleString()}`
            : ""}
        </p>
      )}

      {!enabled ? (
        <div className="p-10 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          Run a backtest to see per-strategy performance on your tracked instruments.
        </div>
      ) : isFetching ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-lg" />)}
        </div>
      ) : isError ? (
        <div className="p-8 rounded-lg text-center text-sm text-destructive" style={{ backgroundColor: card, border: cardBorder }}>
          Backtest failed. Check that instruments are tracked and price history is available.
        </div>
      ) : !data || data.results.length === 0 ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          No results — add tradeable instruments on the Instruments page, then re-run.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.results.map((row) => (
            <ResultCard key={`${row.ticker}-${row.strategy}`} row={row} />
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed pt-2" style={{ color: muted }}>
        Expectancy is the per-trade edge: (Win Rate × Avg Win) − (Loss Rate × Avg Loss) − Cost. A
        positive value means the strategy made money net of costs on this window. Set your round-trip
        cost in Settings → Cost Per Trade for a realistic figure. Backtests use recent hourly closes
        and a simplified always-in-market model (no slippage or overnight financing beyond the cost
        you set). Past performance does not guarantee future results and this is not financial advice.
      </p>
    </div>
  );
}
