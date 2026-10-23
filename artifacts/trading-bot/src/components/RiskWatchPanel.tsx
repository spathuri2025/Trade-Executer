import { Link } from "wouter";
import { useGetRiskWatch, getGetRiskWatchQueryKey } from "@workspace/api-client-react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";
const amber = "#d97706";

/**
 * What is dangerous about the open book right now — positions with no stop,
 * deals added to losers, one instrument too large, open losses past the limit.
 * Above the positions on purpose: in October 2026 every one of these was true
 * of the account's oil shorts while the dashboard showed them as profits.
 */
export function RiskWatchPanel() {
  const { data, isError } = useGetRiskWatch({
    query: { queryKey: getGetRiskWatchQueryKey(), refetchInterval: 60_000, retry: false },
  });

  // No broker connected, or the broker could not be read: the positions card
  // below already says which, and an empty risk panel would read as "safe".
  if (isError || !data) return null;

  if (!data.enabled) {
    return (
      <p className="text-xs" style={{ color: muted }} data-testid="risk-watch-off">
        Risk watch is off.{" "}
        <Link href="/settings" className="underline underline-offset-2">
          Turn it on in Settings
        </Link>{" "}
        to be told about unprotected or growing losing positions.
      </p>
    );
  }

  if (data.findings.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs" style={{ color: muted }} data-testid="risk-watch-clear">
        <ShieldCheck className="h-3.5 w-3.5" /> Risk watch: nothing flagged on your open positions.
      </p>
    );
  }

  return (
    <section
      className="rounded-lg overflow-hidden"
      style={{ backgroundColor: card, border: cardBorder, borderLeft: `3px solid ${amber}` }}
      data-testid="risk-watch"
    >
      <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: divider }}>
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: amber }}>
          <AlertTriangle className="h-4 w-4" />
          Risk watch — {data.findings.length} thing{data.findings.length === 1 ? "" : "s"} to look at
        </div>
        <Link href="/settings" className="text-xs underline underline-offset-2" style={{ color: muted }}>
          Alert levels
        </Link>
      </div>
      {data.findings.map((f, i) => (
        <div
          key={`${f.kind}-${f.ticker ?? ""}-${i}`}
          className="px-5 py-3"
          style={i < data.findings.length - 1 ? { borderBottom: divider } : {}}
          data-testid={`risk-finding-${f.kind}`}
        >
          <div className="text-sm font-medium">{f.title}</div>
          <div className="text-xs mt-1 leading-relaxed" style={{ color: muted }}>
            {f.detail}
          </div>
        </div>
      ))}
      <div className="px-5 py-2 text-[11px]" style={{ color: muted, borderTop: divider }}>
        Watching only — nothing here places, changes or closes a trade.
      </div>
    </section>
  );
}
