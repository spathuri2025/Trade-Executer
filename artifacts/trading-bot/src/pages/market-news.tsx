import { useState } from "react";
import {
  useListMarketNews,
  getListMarketNewsQueryKey,
  useAnalyseNews,
} from "@workspace/api-client-react";
import type { MarketNewsItem, NewsAnalysis } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Newspaper,
  ExternalLink,
  Sparkles,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";
const mutedLo = "hsl(var(--muted-foreground) / 0.7)";
const emerald = "#10b981";
const red = "#f87171";
const amber = "#d97706";

const NEWS_INTERVAL_MS = 15 * 60_000;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

function impactColor(label: string): string {
  return label === "HIGH" ? red : label === "MEDIUM" ? amber : mutedLo;
}

function sentimentTone(sentiment: string) {
  if (sentiment === "bullish") return { color: emerald, Icon: TrendingUp };
  if (sentiment === "bearish") return { color: red, Icon: TrendingDown };
  return { color: amber, Icon: Minus };
}

function impactLevelColor(level: string): string {
  return level === "high" ? red : level === "medium" ? amber : emerald;
}

function AnalysisView({ analysis }: { analysis: NewsAnalysis }) {
  const { color, Icon } = sentimentTone(analysis.sentiment);
  return (
    <div className="mt-4 rounded-lg overflow-hidden" style={{ border: divider }}>
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: divider, backgroundColor: "hsl(var(--accent) / 0.4)" }}>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold tracking-wide"
          style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}3d` }}
        >
          <Icon className="h-3.5 w-3.5" />
          {analysis.sentiment}
        </div>
        <div
          className="px-2.5 py-1 rounded text-[11px] font-semibold tracking-wide"
          style={{
            color: impactLevelColor(analysis.impactLevel),
            backgroundColor: `${impactLevelColor(analysis.impactLevel)}1f`,
            border: `1px solid ${impactLevelColor(analysis.impactLevel)}3d`,
          }}
        >
          {analysis.impactLevel} impact
        </div>
        {analysis.affectedAssets.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {analysis.affectedAssets.map((a, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded text-[11px]"
                style={{ color: mutedLo, backgroundColor: "hsl(var(--muted) / 0.4)" }}
              >
                {a}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div>
          <SectionLabel>Summary</SectionLabel>
          <p className="text-sm mt-1 leading-relaxed">{analysis.summary}</p>
        </div>
        <div>
          <SectionLabel>Why it matters</SectionLabel>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: mutedLo }}>{analysis.whyItMatters}</p>
        </div>
        <div>
          <SectionLabel>Possible market reaction</SectionLabel>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: mutedLo }}>{analysis.possibleReaction}</p>
        </div>
        <div className="rounded-lg p-3" style={{ backgroundColor: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)" }}>
          <SectionLabel>Risk warning</SectionLabel>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(248,113,113,0.9)" }}>{analysis.riskWarning}</p>
        </div>
        {analysis.disclaimer && (
          <p className="text-[11px] leading-relaxed" style={{ color: mutedLo }}>{analysis.disclaimer}</p>
        )}
      </div>
    </div>
  );
}

function NewsRow({ item }: { item: MarketNewsItem }) {
  const [analysis, setAnalysis] = useState<NewsAnalysis | null>(null);
  const analyse = useAnalyseNews({
    mutation: {
      onSuccess: (res) => setAnalysis(res),
    },
  });

  return (
    <div className="p-5" style={{ borderBottom: divider }}>
      <div className="flex items-start gap-4">
        <div className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: impactColor(item.impactLabel) }} />
        <div className="flex-1 min-w-0">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-start gap-1.5"
          >
            <p className="text-sm font-medium leading-snug group-hover:text-primary transition-colors">{item.title}</p>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-40 group-hover:opacity-80 transition-opacity" style={{ color: muted }} />
          </a>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs" style={{ color: muted }}>{item.source}</span>
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: "hsl(var(--border))" }} />
            <span className="text-xs" style={{ color: muted }}>
              {item.publishedAt ? new Date(item.publishedAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
            </span>
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide"
              style={{ color: impactColor(item.impactLabel), backgroundColor: `${impactColor(item.impactLabel)}1f` }}
            >
              {item.impactLabel}
            </span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={analyse.isPending}
          onClick={() => analyse.mutate({ data: { headline: item.title, source: item.source, articleUrl: item.url } })}
          data-testid={`button-analyse-${item.id}`}
        >
          {analyse.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          {analyse.isPending ? "Analysing…" : analysis ? "Re-analyse" : "AI Analyse"}
        </Button>
      </div>

      {analyse.isError && (
        <p className="text-xs mt-3 text-destructive">Couldn't analyse this headline right now.</p>
      )}
      {analysis && <AnalysisView analysis={analysis} />}
    </div>
  );
}

export default function MarketNews() {
  const { data, isLoading } = useListMarketNews(
    { limit: 40 },
    {
      query: {
        queryKey: getListMarketNewsQueryKey({ limit: 40 }),
        refetchInterval: NEWS_INTERVAL_MS,
        staleTime: NEWS_INTERVAL_MS,
      },
    },
  );

  const items = data?.items ?? [];

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 40, height: 40, borderRadius: 10,
              background: "hsl(var(--primary) / 0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Newspaper className="h-5 w-5" style={{ color: "hsl(var(--primary))" }} />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-light tracking-tight">Market News</h1>
            <p className="text-sm mt-1" style={{ color: muted }}>
              Live market headlines — tap <span className="font-medium">AI Analyse</span> for an instant plain-language read.
            </p>
          </div>
        </div>
      </div>

      {data?.mock && (
        <div
          className="rounded-lg px-4 py-3 text-xs"
          style={{ color: amber, backgroundColor: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.3)" }}
        >
          Showing sample headlines — live news wasn't available. AI analysis still works on these examples.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          No market news available right now.
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
          {items.map((item) => (
            <NewsRow key={item.id} item={item} />
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed" style={{ color: mutedLo }}>
        News and AI analysis are for informational purposes only and are not financial advice. Trading involves
        substantial risk of loss. Always do your own research before acting on any headline.
      </p>
    </div>
  );
}
