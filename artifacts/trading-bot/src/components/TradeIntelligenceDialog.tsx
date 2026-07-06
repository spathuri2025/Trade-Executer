import type { Signal } from "@workspace/api-client-react";
import { useEvaluateTradeIntelligenceWithClaude } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles } from "lucide-react";
import { ConfidenceBar, RiskBadge, SignalBadge } from "@/components/SignalBadges";
import { buildTradeIntelligenceInput } from "@/lib/tradeIntelligenceInput";

const muted = "hsl(var(--muted-foreground))";
const mutedLo = "hsl(var(--muted-foreground) / 0.7)";
const divider = "1px solid hsl(var(--border))";

const TRADE_INTELLIGENCE_DISCLAIMER =
  "TradeBuzz provides market analysis and educational information only. This is not financial advice. Trading involves risk.";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

function FactorList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TradeIntelligenceDialog({ signal }: { signal: Signal }) {
  const evaluate = useEvaluateTradeIntelligenceWithClaude();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          onClick={() => evaluate.mutate({ data: buildTradeIntelligenceInput(signal) })}
          data-testid={`button-trade-intelligence-${signal.id}`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI Intelligence
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trade Intelligence — {signal.ticker}</DialogTitle>
        </DialogHeader>

        {/* Deterministic TradeBuzz score — always shown, independent of Claude. */}
        <div className="flex items-center gap-3 flex-wrap pb-3" style={{ borderBottom: divider }}>
          <SignalBadge signal={signal.signal} />
          {signal.riskLevel ? <RiskBadge level={signal.riskLevel} /> : null}
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>
              Confidence
            </span>
            <ConfidenceBar value={signal.confidence} />
          </div>
        </div>

        {evaluate.isPending && (
          <div className="space-y-2 pt-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        )}

        {evaluate.isError && (
          <p className="text-xs text-destructive pt-1">
            AI analysis unavailable right now — the deterministic score above is still accurate.
          </p>
        )}

        {evaluate.data && (
          <div className="space-y-3 pt-1">
            <div>
              <SectionLabel>Summary</SectionLabel>
              <p className="text-sm mt-1 leading-relaxed">{evaluate.data.summary}</p>
            </div>

            <FactorList title="Bullish factors" items={evaluate.data.bullishFactors} color="#10b981" />
            <FactorList title="Bearish factors" items={evaluate.data.bearishFactors} color="hsl(var(--destructive))" />

            {evaluate.data.warnings.length > 0 && (
              <div
                className="rounded-lg p-3"
                style={{ backgroundColor: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.3)" }}
              >
                <SectionLabel>Warnings</SectionLabel>
                <ul className="mt-1 space-y-1">
                  {evaluate.data.warnings.map((w, i) => (
                    <li key={i} className="text-xs" style={{ color: "rgba(217,119,6,0.9)" }}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <SectionLabel>Trade narrative</SectionLabel>
              <p className="text-sm mt-1 leading-relaxed" style={{ color: mutedLo }}>{evaluate.data.tradeNarrative}</p>
            </div>

            <div>
              <SectionLabel>Beginner explanation</SectionLabel>
              <p className="text-sm mt-1 leading-relaxed" style={{ color: mutedLo }}>{evaluate.data.beginnerExplanation}</p>
            </div>

            <div>
              <SectionLabel>Advanced explanation</SectionLabel>
              <p className="text-sm mt-1 leading-relaxed" style={{ color: mutedLo }}>{evaluate.data.advancedExplanation}</p>
            </div>

            <div>
              <SectionLabel>Final recommendation</SectionLabel>
              <p className="text-sm mt-1 font-medium">{evaluate.data.finalRecommendation}</p>
            </div>

            <div>
              <SectionLabel>Invalidation</SectionLabel>
              <p className="text-sm mt-1 leading-relaxed" style={{ color: mutedLo }}>{evaluate.data.invalidationReason}</p>
            </div>

            <div
              className="rounded-lg p-3"
              style={{ backgroundColor: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)" }}
            >
              <SectionLabel>Risk warning</SectionLabel>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(248,113,113,0.9)" }}>{evaluate.data.riskWarning}</p>
            </div>
          </div>
        )}

        <p className="text-[11px] leading-relaxed pt-2" style={{ color: mutedLo, borderTop: divider }}>
          {TRADE_INTELLIGENCE_DISCLAIMER}
        </p>
      </DialogContent>
    </Dialog>
  );
}
