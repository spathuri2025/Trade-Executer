import { useState } from "react";
import {
  useGetActivityFeed,
  getGetActivityFeedQueryKey,
  type ActivityItem,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ScanSearch, Activity as ActivityIcon, ListOrdered } from "lucide-react";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";
const mutedLo = "hsl(var(--muted-foreground) / 0.7)";
const emerald = "#10b981";
const red = "#f87171";
const amber = "#d97706";

const LIVE_INTERVAL_MS = 20_000;

const TYPE_META: Record<ActivityItem["type"], { label: string; icon: typeof ScanSearch }> = {
  scan: { label: "Scan", icon: ScanSearch },
  signal: { label: "Signal", icon: ActivityIcon },
  trade: { label: "Trade", icon: ListOrdered },
};

function directionStyle(dir: string | null) {
  if (dir === "BUY") return { color: emerald, backgroundColor: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" };
  if (dir === "SELL") return { color: red, backgroundColor: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)" };
  return { color: amber, backgroundColor: "rgba(217,119,6,0.12)", border: "1px solid rgba(217,119,6,0.25)" };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span style={{ color: mutedLo }}>{label}</span>
      <span className="tabular-nums text-right" style={{ color: muted }}>{value}</span>
    </div>
  );
}

const STRATEGY_LABEL: Record<string, string> = {
  trend_following: "Trend-following",
  mean_reversion: "Mean-reversion",
};

function summaryText(item: ActivityItem): string {
  if (item.type === "scan") return `Scanner flagged ${item.signal ?? ""} on ${item.ticker}`;
  if (item.type === "signal") {
    return item.signal === "HOLD"
      ? `Signal: HOLD on ${item.ticker}`
      : `Signal: ${item.signal ?? ""} on ${item.ticker}${item.autoTraded ? " · traded" : ""}`;
  }
  const kind = item.status === "DRY_RUN" ? "Dry-run" : item.status === "FAILED" ? "Failed" : "Executed";
  return `${kind} ${item.side ?? ""} ${item.ticker}`;
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  const dir = item.signal ?? item.side;

  const time = new Date(item.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = time.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div style={{ borderBottom: divider }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-4 text-left transition-colors"
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "hsl(var(--accent))")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
        data-testid={`activity-row-${item.id}`}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: "hsl(var(--accent))" }}
        >
          <Icon className="h-4 w-4" style={{ color: muted }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{summaryText(item)}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: mutedLo }}>
              {meta.label}
            </span>
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: "hsl(var(--border))" }} />
            <span className="text-xs tabular-nums" style={{ color: mutedLo }}>{dateStr} {timeStr}</span>
          </div>
        </div>
        {dir && (
          <span className="px-2 py-1 rounded text-[10px] font-bold tracking-wider shrink-0" style={directionStyle(dir)}>
            {dir}
          </span>
        )}
        <ChevronDown
          className="h-4 w-4 shrink-0 transition-transform"
          style={{ color: muted, transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-1.5 text-xs" style={{ backgroundColor: "hsl(var(--accent) / 0.35)" }}>
          <DetailRow label="Instrument" value={item.name ? `${item.ticker} · ${item.name}` : item.ticker} />
          {item.price != null && <DetailRow label="Price" value={item.price.toFixed(2)} />}
          {item.shortMa != null && item.longMa != null && (
            <DetailRow label="MA (short / long)" value={`${item.shortMa.toFixed(2)} / ${item.longMa.toFixed(2)}`} />
          )}
          {item.trendStrength != null && (
            <DetailRow label="Trend strength" value={item.trendStrength.toFixed(2)} />
          )}
          {item.strategy && (
            <DetailRow label="Strategy" value={STRATEGY_LABEL[item.strategy] ?? item.strategy} />
          )}
          {item.regime && (
            <DetailRow label="Regime" value={item.regime === "trending" ? "Trending" : "Ranging"} />
          )}
          {item.quantity != null && <DetailRow label="Quantity" value={item.quantity} />}
          {item.total != null && <DetailRow label="Total" value={item.total.toFixed(2)} />}
          {item.status && <DetailRow label="Status" value={item.status.replace("_", " ")} />}
          {item.aiConfidence && <DetailRow label="AI confidence" value={item.aiConfidence} />}
          {item.errorMessage && (
            <DetailRow label="Error" value={<span style={{ color: red }}>{item.errorMessage}</span>} />
          )}
          {item.aiReason && (
            <div className="pt-1">
              <div style={{ color: mutedLo }} className="mb-0.5">AI reason</div>
              <div style={{ color: muted }} className="leading-relaxed">{item.aiReason}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ActivityFeed() {
  const { data, isLoading } = useGetActivityFeed(
    { limit: 30 },
    {
      query: {
        queryKey: getGetActivityFeedQueryKey({ limit: 30 }),
        refetchInterval: LIVE_INTERVAL_MS,
      },
    },
  );

  const items = data?.items ?? [];

  return (
    <section className="space-y-5">
      <SectionLabel>Activity Feed</SectionLabel>
      <div className="rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
        {isLoading ? (
          <div className="p-5 space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : items.length === 0 ? (
          <div className="p-5 text-sm text-center" style={{ color: muted }}>
            No activity yet — scans, signals, and trades will appear here as the bot runs.
          </div>
        ) : (
          items.map((item) => <ActivityRow key={item.id} item={item} />)
        )}
      </div>
    </section>
  );
}
