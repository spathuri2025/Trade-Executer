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

function isFromToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
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
      // The server self-populates one brief per day in the background; poll until
      // today's brief is available, then stop.
      refetchInterval: (query) => {
        const b = query.state.data?.brief;
        return b && isFromToday(b.createdAt) ? false : 5000;
      },
    },
  });

  const brief = data?.brief ?? null;
  if (!brief) return null;

  return (
    <div
      className="rounded-lg p-5 space-y-3"
      style={{ background: "hsl(var(--primary) / 0.06)", border: cardBorder }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" style={{ color: amber }} />
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
          Your daily briefing
        </span>
      </div>

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
