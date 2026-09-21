import { useState } from "react";
import { useGetLivePerformance, getGetLivePerformanceQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Wallet, Info } from "lucide-react";

/**
 * Real results from the broker's own transaction history. The one place in the
 * app that answers "is the bot making money?" — take-profits, stop-losses and
 * manual closes all happen at the broker and never reach the bot's trade log,
 * so nothing else here can.
 */

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";
const emerald = "#10b981";
const red = "#f87171";
const amber = "#d97706";

/** Below this many closed trades, the numbers say more about luck than the strategy. */
const MEANINGFUL_SAMPLE = 50;

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

function signColor(v: number | null | undefined): string {
  if (v == null || v === 0) return muted;
  return v > 0 ? emerald : red;
}

function money(v: number | null | undefined, currency: string | null): string {
  if (v == null) return "—";
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  const body = `${symbol}${Math.abs(v).toFixed(2)}`;
  return symbol ? `${sign}${body}` : `${sign}${body}${currency ? ` ${currency}` : ""}`;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>{children}</div>
  );
}

function Tile({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="p-4 space-y-1" style={{ borderRight: divider, borderBottom: divider }}>
      <Label>{label}</Label>
      <div className="text-lg font-mono" style={{ color: color ?? "inherit" }}>{value}</div>
      {hint && <div className="text-xs" style={{ color: muted }}>{hint}</div>}
    </div>
  );
}

const CLOSE_LABEL: Record<string, string> = {
  "take-profit": "Take-profit",
  "stop-loss": "Stop-loss",
  closed: "Closed",
};

export function LivePerformance() {
  const [days, setDays] = useState<Period>(30);
  const { data, isLoading, isError, error } = useGetLivePerformance(
    { days },
    { query: { queryKey: getGetLivePerformanceQueryKey({ days }), staleTime: 60_000, retry: false } }
  );

  const periodPicker = (
    <div className="flex items-center gap-1" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setDays(p)}
          aria-pressed={days === p}
          className="px-2.5 py-1 rounded text-xs font-mono transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          style={{
            backgroundColor: days === p ? "hsl(var(--primary) / 0.15)" : "transparent",
            color: days === p ? "hsl(var(--primary))" : muted,
            border: divider,
          }}
          data-testid={`live-period-${p}`}
        >
          {p}d
        </button>
      ))}
    </div>
  );

  // The API's error body is { error: string }; show the broker's reason, not a generic line.
  const errorMessage =
    (error as { data?: { error?: string } } | null)?.data?.error ?? "Couldn't load your live results right now.";

  return (
    <CollapsibleSection
      id="performance.live"
      title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Live results</span>}
      defaultOpen
      meta={periodPicker}
      description={
        <>
          From Capital.com&rsquo;s own history, so it includes take-profits, stop-losses and anything you
          close yourself. Results include the spread; funding and fees are counted in the net.
        </>
      }
      contentClassName="space-y-5"
    >
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : isError || !data ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          {errorMessage}
        </div>
      ) : data.closedTrades === 0 ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          No trades closed in the last {data.days} days.
        </div>
      ) : (
        <>
          {data.closedTrades < MEANINGFUL_SAMPLE && (
            <div
              className="flex items-start gap-2 px-4 py-3 rounded-lg text-sm"
              style={{ color: amber, backgroundColor: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.3)" }}
              data-testid="live-sample-warning"
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {data.closedTrades} closed {data.closedTrades === 1 ? "trade" : "trades"} so far. Around{" "}
                {MEANINGFUL_SAMPLE} are needed before these numbers tell a working strategy from a lucky run.
              </span>
            </div>
          )}

          <div
            className="grid grid-cols-2 lg:grid-cols-4 rounded-lg overflow-hidden"
            style={{ backgroundColor: card, border: cardBorder }}
          >
            <Tile label="Net result" value={money(data.netResult, data.currency)} color={signColor(data.netResult)} />
            <Tile
              label="Per trading day"
              value={money(data.averagePerTradingDay, data.currency)}
              color={signColor(data.averagePerTradingDay)}
              hint={`over ${data.tradingDays} ${data.tradingDays === 1 ? "day" : "days"} with a close`}
            />
            <Tile label="Closed trades" value={String(data.closedTrades)} hint={`${data.wins} won · ${data.losses} lost`} />
            <Tile
              label="Win rate"
              value={data.winRate == null ? "—" : `${Math.round(data.winRate * 100)}%`}
            />
            <Tile label="Average win" value={money(data.averageWin, data.currency)} color={signColor(data.averageWin)} />
            <Tile label="Average loss" value={money(data.averageLoss, data.currency)} color={signColor(data.averageLoss)} />
            <Tile
              label="Profit factor"
              value={data.profitFactor == null ? "—" : data.profitFactor.toFixed(2)}
              color={data.profitFactor == null ? undefined : data.profitFactor >= 1 ? emerald : red}
              hint="won ÷ lost · above 1 is profitable"
            />
            <Tile
              label="Funding & fees"
              value={money(data.funding + data.fees, data.currency)}
              color={signColor(data.funding + data.fees)}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
              <div className="px-4 py-3" style={{ borderBottom: divider }}>
                <Label>By day</Label>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {data.byDay.map((d) => (
                  <div key={d.date} className="flex items-center justify-between px-4 py-2 text-sm" style={{ borderBottom: divider }}>
                    <span className="font-mono">{d.date}</span>
                    <span className="text-xs" style={{ color: muted }}>
                      {d.trades} {d.trades === 1 ? "trade" : "trades"}
                    </span>
                    <span className="font-mono" style={{ color: signColor(d.net) }}>{money(d.net, data.currency)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
              <div className="px-4 py-3" style={{ borderBottom: divider }}>
                <Label>By instrument · worst first</Label>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {data.byInstrument.map((i) => (
                  <div key={i.instrumentName} className="flex items-center justify-between gap-3 px-4 py-2 text-sm" style={{ borderBottom: divider }}>
                    <span className="truncate">{i.instrumentName || "—"}</span>
                    <span className="text-xs shrink-0" style={{ color: muted }}>
                      {i.trades} {i.trades === 1 ? "trade" : "trades"}
                    </span>
                    <span className="font-mono shrink-0" style={{ color: signColor(i.net) }}>{money(i.net, data.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
            <div className="px-4 py-3" style={{ borderBottom: divider }}>
              <Label>Recent closes</Label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: divider, color: muted }}>
                    <th className="text-left font-normal px-4 py-2 text-xs">Closed (UTC)</th>
                    <th className="text-left font-normal px-4 py-2 text-xs">Instrument</th>
                    <th className="text-left font-normal px-4 py-2 text-xs">How</th>
                    <th className="text-right font-normal px-4 py-2 text-xs">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTrades.map((t, idx) => (
                    <tr key={`${t.dateUtc}-${idx}`} style={{ borderBottom: divider }}>
                      <td className="px-4 py-2 font-mono whitespace-nowrap">{t.dateUtc.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-4 py-2">{t.instrumentName}</td>
                      <td className="px-4 py-2 text-xs" style={{ color: muted }}>{CLOSE_LABEL[t.closeType] ?? t.closeType}</td>
                      <td className="px-4 py-2 text-right font-mono" style={{ color: signColor(t.result) }}>
                        {money(t.result, data.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
