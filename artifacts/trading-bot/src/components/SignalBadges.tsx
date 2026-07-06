import { Badge } from "@/components/ui/badge";

const muted = "hsl(var(--muted-foreground))";

export function SignalBadge({ signal }: { signal: string }) {
  const cls =
    signal === "BUY"  ? "text-primary border-primary bg-primary/10" :
    signal === "SELL" ? "text-destructive border-destructive bg-destructive/10" :
    "text-amber-500 border-amber-500 bg-amber-500/10";
  return <Badge variant="outline" className={cls}>{signal}</Badge>;
}

export function RiskBadge({ level }: { level?: string | null }) {
  if (!level) return null;
  const cls =
    level === "Low"
      ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/10"
      : level === "Medium"
      ? "text-amber-400 border-amber-400/40 bg-amber-400/10"
      : "text-destructive border-destructive/40 bg-destructive/10";
  return <Badge variant="outline" className={cls}>{level} risk</Badge>;
}

export function ConfidenceBar({ value }: { value?: number | null }) {
  if (value == null) return <span style={{ color: muted }}>—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full overflow-hidden" style={{ backgroundColor: "hsl(var(--border))" }}>
        <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: "hsl(var(--primary))" }} />
      </div>
      <span className="text-xs tabular-nums" style={{ color: muted }}>{value}%</span>
    </div>
  );
}
