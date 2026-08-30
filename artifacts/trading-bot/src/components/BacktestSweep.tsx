import { useQueryClient } from "@tanstack/react-query";
import {
  useStartBacktestSweep,
  useGetBacktestSweep,
  getGetBacktestSweepQueryKey,
  type SweepCombo,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical } from "lucide-react";

/**
 * Runs every instrument × timeframe × strategy × parameter set and reports
 * whether anything survives out-of-sample testing.
 *
 * The verdict is shown FIRST and the winning rows second, on purpose. A sweep
 * always produces an impressive-looking best row — that is what sweeps do — so
 * leading with the table would mislead. The verdict is what should be acted on.
 */

const VERDICT_STYLE: Record<string, { label: string; className: string }> = {
  "worth-forward-testing": { label: "Worth forward-testing", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  weak: { label: "No better than chance", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  "no-edge": { label: "No edge found", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  "insufficient-data": { label: "Not enough data", className: "border-border bg-muted/20 text-muted-foreground" },
};

const pct = (v: number, dp = 3) => `${(v * 100).toFixed(dp)}%`;

function ComboRow({ c }: { c: SweepCombo }) {
  return (
    <tr className="border-b border-border/50 last:border-0" data-testid={`sweep-row-${c.ticker}-${c.resolution}`}>
      <td className="py-2 pr-3">
        <div className="font-medium">{c.ticker}</div>
        <div className="text-xs text-muted-foreground">{c.resolution.replace("MINUTE_", "").replace("MINUTE", "1")}m/{c.strategy.replace(/_/g, " ")}</div>
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{c.params}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{c.inSample.trades}/{c.outOfSample.trades}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{pct(c.inSample.expectancyPct)}</td>
      <td className={`py-2 pr-3 text-right tabular-nums ${c.outOfSample.expectancyPct > 0 ? "text-emerald-400" : "text-destructive"}`}>
        {pct(c.outOfSample.expectancyPct)}
      </td>
      <td className="py-2 text-right">
        {c.robust ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">held up</Badge> : null}
      </td>
    </tr>
  );
}

export function BacktestSweep() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sweepKey = getGetBacktestSweepQueryKey();
  const [scope, setScope] = useState<"watchlist" | "universe">("watchlist");

  const { data, isLoading } = useGetBacktestSweep({
    query: {
      queryKey: sweepKey,
      // Poll only while a run is in flight; a finished sweep is static.
      refetchInterval: (q) => (q.state.data?.sweep?.status === "running" ? 5_000 : false),
    },
  });

  const start = useStartBacktestSweep({
    mutation: {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: sweepKey });
        toast({
          title: "Sweep started",
          description: `Testing ${r?.instruments ?? "your"} instrument${r?.instruments === 1 ? "" : "s"} — results appear here.`,
        });
      },
      onError: (err: any) => {
        toast({
          title: "Couldn't start the sweep",
          description: err?.response?.data?.error ?? err?.message,
          variant: "destructive",
        });
      },
    },
  });

  const sweep = data?.sweep ?? null;
  const running = sweep?.status === "running";
  const summary = sweep?.summary ?? null;
  const results = sweep?.results ?? null;
  const verdict = summary ? VERDICT_STYLE[summary.verdict] ?? VERDICT_STYLE["insufficient-data"]! : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4" /> Strategy Sweep
            </CardTitle>
            <CardDescription>
              Tests instruments across timeframes, strategies and parameter sets — then checks
              whether the winners hold up on data they weren't chosen on. "Whole market" searches
              the broker's catalogue for an edge instead of assuming your watchlist has one.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
              <SelectTrigger className="w-[190px]" data-testid="select-sweep-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="watchlist">My instruments</SelectItem>
                <SelectItem value="universe">Whole market (150)</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => start.mutate({ data: { scope } })}
              disabled={running || start.isPending}
              data-testid="button-run-sweep"
            >
              {running ? "Running…" : start.isPending ? "Starting…" : "Run sweep"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !sweep ? (
          <p className="text-sm text-muted-foreground">
            No sweep has been run yet. This is the evidence step before raising risk: it answers
            whether any configuration makes money on average, after real spread costs.
          </p>
        ) : running ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Testing {sweep.combosDone} of {sweep.combosTotal || "…"} instrument/timeframe pairs. Paced
              deliberately so the broker's API isn't hammered — a few minutes is normal.
            </p>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: sweep.combosTotal ? `${(sweep.combosDone / sweep.combosTotal) * 100}%` : "5%" }}
              />
            </div>
          </div>
        ) : sweep.status === "failed" ? (
          <p className="text-sm text-destructive">Sweep failed: {sweep.error ?? "unknown error"}</p>
        ) : summary && verdict ? (
          <>
            <div className={`rounded-lg border p-4 ${verdict.className}`} data-testid="sweep-verdict">
              <div className="font-medium mb-1">{verdict.label}</div>
              <p className="text-sm opacity-90">{summary.verdictText}</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Combinations</div>
                <div className="mt-1 font-mono">{summary.combosTested}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Enough trades</div>
                <div className="mt-1 font-mono">{summary.combosWithEnoughTrades}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Held up out-of-sample</div>
                <div className="mt-1 font-mono">
                  {summary.positiveOutOfSample} ({Math.round(summary.outOfSamplePositiveRate * 100)}%)
                </div>
                {/* The number luck alone produces. Without it, "84 winners!"
                    reads as a discovery instead of slightly below par. */}
                <div className="text-xs text-muted-foreground mt-0.5">
                  ~{summary.expectedPositiveByChance} expected by chance
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Median edge / trade</div>
                <div className={`mt-1 font-mono ${summary.medianOutOfSampleExpectancy > 0 ? "text-emerald-400" : "text-destructive"}`}>
                  {pct(summary.medianOutOfSampleExpectancy)}
                </div>
              </div>
            </div>

            {results && results.length > 0 && (
              <div className="overflow-x-auto">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Best 15 by out-of-sample edge
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="text-left py-2 pr-3 font-normal">Instrument</th>
                      <th className="text-left py-2 pr-3 font-normal">Params</th>
                      <th className="text-right py-2 pr-3 font-normal">Trades in/out</th>
                      <th className="text-right py-2 pr-3 font-normal">In-sample</th>
                      <th className="text-right py-2 pr-3 font-normal">Out-of-sample</th>
                      <th className="text-right py-2 font-normal"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.filter((c) => c.hasEnoughTrades).slice(0, 15).map((c, i) => (
                      <ComboRow key={`${c.ticker}-${c.resolution}-${c.strategy}-${c.params}-${i}`} c={c} />
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-3">
                  Only rows with {summary.combosWithEnoughTrades > 0 ? "enough trades in both windows" : "sufficient samples"} are
                  listed. A high in-sample figure with a negative out-of-sample one is the signature of
                  a setting fitted to the past rather than an edge.
                </p>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
