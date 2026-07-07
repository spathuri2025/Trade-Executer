import { useMemo, useState, useEffect } from "react";
import { useGetCandles, getGetCandlesQueryKey, useListInstruments } from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CandlestickChart as CandlestickIcon } from "lucide-react";
import { useLiveQuote } from "@/hooks/use-live-prices";
import CandlestickChart from "@/components/CandlestickChart";
import ChartInsightPanel from "@/components/ChartInsightPanel";

/* ── design tokens ── */
const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const muted = "hsl(var(--muted-foreground))";
const emerald = "#10b981";
const red = "#f87171";

const RESOLUTIONS: { value: string; label: string }[] = [
  { value: "MINUTE", label: "1 min" },
  { value: "MINUTE_5", label: "5 min" },
  { value: "MINUTE_15", label: "15 min" },
  { value: "MINUTE_30", label: "30 min" },
  { value: "HOUR", label: "1 hour" },
  { value: "HOUR_4", label: "4 hour" },
  { value: "DAY", label: "1 day" },
  { value: "WEEK", label: "1 week" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

export default function Charts() {
  const { data: instruments, isLoading: instrumentsLoading } = useListInstruments();
  const [epic, setEpic] = useState<string>("");
  const [resolution, setResolution] = useState<string>("HOUR");

  // Default the selected instrument to the first one once loaded.
  useEffect(() => {
    if (!epic && instruments && instruments.length > 0) {
      setEpic(instruments[0].ticker);
    }
  }, [epic, instruments]);

  const {
    data: candles,
    isLoading: candlesLoading,
    isError: candlesError,
  } = useGetCandles(
    { epic, resolution, count: 300 },
    {
      query: {
        queryKey: getGetCandlesQueryKey({ epic, resolution, count: 300 }),
        enabled: !!epic,
      },
    },
  );

  const { quote: liveQuote, connected } = useLiveQuote(epic);
  const liveMid = liveQuote ? liveQuote.mid : null;
  const liveTime = liveQuote ? liveQuote.timestamp : null;

  const bars = useMemo(() => candles ?? [], [candles]);

  const selectedName = useMemo(
    () => instruments?.find((i) => i.ticker === epic)?.name ?? epic,
    [instruments, epic],
  );

  const noInstruments = !instrumentsLoading && (!instruments || instruments.length === 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "hsl(var(--primary) / 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CandlestickIcon className="h-5 w-5" style={{ color: "hsl(var(--primary))" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>Charts</h1>
            <p style={{ fontSize: 12, color: muted }}>
              Historical candles from Capital.com with a live streaming overlay
            </p>
          </div>
        </div>

        {/* Selectors */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Select value={epic} onValueChange={setEpic} disabled={noInstruments}>
            <SelectTrigger style={{ width: 200 }}>
              <SelectValue placeholder="Select instrument" />
            </SelectTrigger>
            <SelectContent>
              {(instruments ?? []).map((i) => (
                <SelectItem key={i.id} value={i.ticker}>
                  {i.ticker} — {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={resolution} onValueChange={setResolution}>
            <SelectTrigger style={{ width: 120 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOLUTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Chart card */}
      <div
        style={{
          background: card,
          border: cardBorder,
          borderRadius: 14,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <SectionLabel>Candlestick</SectionLabel>
            <p style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
              {epic ? selectedName : "No instrument selected"}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: connected ? emerald : red,
                boxShadow: connected ? "0 0 8px rgba(16,185,129,0.5)" : "none",
              }}
            />
            <span style={{ fontSize: 11, color: muted }}>
              {connected ? "Live" : "Stream offline"}
            </span>
          </div>
        </div>

        <div style={{ height: 480, position: "relative" }}>
          {noInstruments ? (
            <EmptyState
              title="No instruments yet"
              body="Add instruments on the Instruments page to chart them here."
            />
          ) : !epic || candlesLoading || instrumentsLoading ? (
            <Skeleton style={{ width: "100%", height: "100%", borderRadius: 10 }} />
          ) : candlesError ? (
            <EmptyState
              title="Couldn't load candles"
              body="Capital.com didn't return price history for this instrument. The market may be closed or the epic isn't available."
            />
          ) : bars.length === 0 ? (
            <EmptyState
              title="No candle data"
              body="No historical bars were returned for this instrument and timeframe."
            />
          ) : (
            <CandlestickChart bars={bars} liveMid={liveMid} liveTime={liveTime} resolution={resolution} />
          )}
        </div>
      </div>

      {/* AI technical read */}
      {epic && !noInstruments && <ChartInsightPanel epic={epic} resolution={resolution} />}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 6,
        padding: 24,
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 600 }}>{title}</p>
      <p style={{ fontSize: 12, color: muted, maxWidth: 360 }}>{body}</p>
    </div>
  );
}
