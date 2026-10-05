import {
  useGetAssistantDailyBrief,
  getGetAssistantDailyBriefQueryKey,
} from "@workspace/api-client-react";
import type { BriefHighlight } from "@workspace/api-client-react";
import { Sparkles, Target, AlertTriangle, Bell } from "lucide-react";

const cardBorder = "1px solid hsl(var(--card-border))";
const muted = "hsl(var(--muted-foreground))";
const mutedLo = "hsl(var(--muted-foreground) / 0.7)";
const emerald = "#10b981";
const red = "#f87171";
const amber = "#d97706";

/** "28 September" — for saying plainly which day a stale briefing describes. */
function dayLabel(briefDate: string): string {
  const d = new Date(`${briefDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return briefDate;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" });
}

function highlightTone(type: string) {
  if (type === "opportunity") return { color: emerald, Icon: Target };
  if (type === "risk") return { color: red, Icon: AlertTriangle };
  return { color: amber, Icon: Bell };
}

function HighlightRow({ h }: { h: BriefHighlight }) {
  const { color, Icon } = highlightTone(h.type);
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color }} />
      <span className="text-sm leading-snug" style={{ color: "hsl(var(--foreground) / 0.9)" }}>{h.text}</span>
    </div>
  );
}

export default function AssistantDailyBrief() {
  const { data } = useGetAssistantDailyBrief({
    query: {
      queryKey: getGetAssistantDailyBriefQueryKey(),
      // The server self-populates one brief per day in the background. Poll
      // while it says the one we hold is stale or a fresh one is being written,
      // and stop once today's has arrived. Driven by the server's own flags
      // rather than re-deriving "is this today" from a timestamp here — the
      // server knows which day the brief was written FOR, which is the thing
      // that matters.
      refetchInterval: (query) => {
        const d = query.state.data;
        if (!d) return 5000;
        return d.stale || d.generating ? 5000 : false;
      },
    },
  });

  const brief = data?.brief ?? null;
  const stale = data?.stale ?? false;
  const generating = data?.generating ?? false;

  // Nothing written yet: say so, rather than rendering nothing while the user
  // waits with no idea anything is coming.
  if (!brief) {
    return generating ? (
      <div className="rounded-lg p-5" style={{ background: "hsl(var(--primary) / 0.06)", border: cardBorder }}>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" style={{ color: amber }} />
          <span className="text-sm" style={{ color: muted }}>Preparing today&rsquo;s briefing&hellip;</span>
        </div>
      </div>
    ) : null;
  }

  return (
    <div
      className="rounded-lg p-5 space-y-3"
      style={{ background: "hsl(var(--primary) / 0.06)", border: cardBorder }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" style={{ color: amber }} />
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
          {stale ? `Your briefing from ${dayLabel(brief.briefDate)}` : "Your daily briefing"}
        </span>
      </div>

      {stale && (
        <div
          className="flex items-start gap-2 rounded-md p-2.5"
          style={{ background: "hsl(var(--muted) / 0.4)" }}
          data-testid="brief-stale-notice"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: amber }} />
          <span className="text-xs leading-snug" style={{ color: muted }}>
            This was written on {dayLabel(brief.briefDate)}, so any balance or position it mentions is
            from that day &mdash; not now.{" "}
            {generating ? "Today's is being prepared and will appear here." : "Today's has not been written yet."}
          </span>
        </div>
      )}

      <p className="text-sm leading-relaxed" style={{ color: "hsl(var(--foreground) / 0.92)" }}>
        {brief.message}
      </p>

      {brief.highlights.length > 0 && (
        <div className="space-y-2 pt-1">
          {brief.highlights.map((h, i) => (
            <HighlightRow key={i} h={h} />
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed pt-1" style={{ color: mutedLo }}>
        {brief.disclaimer}
      </p>
    </div>
  );
}
