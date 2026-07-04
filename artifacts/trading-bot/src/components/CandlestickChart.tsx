import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from "lightweight-charts";

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const emerald = "#10b981";
const red = "#f87171";

/** Candle duration in seconds for each Capital.com resolution. */
const RESOLUTION_SECONDS: Record<string, number> = {
  MINUTE: 60,
  MINUTE_5: 300,
  MINUTE_15: 900,
  MINUTE_30: 1800,
  HOUR: 3600,
  HOUR_4: 14400,
  DAY: 86400,
  WEEK: 604800,
};

/** Normalise a possibly-millisecond timestamp to UNIX seconds. */
function toSeconds(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
}

/**
 * TradingView lightweight-charts candlestick series. `bars` seeds the chart
 * (historical OHLC). `liveMid`/`liveTime` stream the latest tick: it is merged
 * into the current forming candle, and when the tick crosses into a new
 * interval a fresh candle is appended (aligned to the historical bar grid).
 */
export default function CandlestickChart({
  bars,
  liveMid,
  liveTime,
  resolution,
}: {
  bars: Bar[];
  liveMid: number | null;
  liveTime: number | null;
  resolution: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastBarRef = useRef<Bar | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.55)",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: emerald,
      downColor: red,
      borderUpColor: emerald,
      borderDownColor: red,
      wickUpColor: emerald,
      wickDownColor: red,
    });
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lastBarRef.current = null;
    };
  }, []);

  // Seed / replace the full data set whenever bars change (new instrument or resolution).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const data: CandlestickData[] = bars.map((b) => ({
      time: b.time as UTCTimestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    series.setData(data);
    lastBarRef.current = bars.length ? { ...bars[bars.length - 1] } : null;
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  // Merge each live tick into the current forming candle, or start a new candle
  // when the tick crosses into a later interval. New candles are aligned to the
  // historical bar grid (last.time + k*duration) so alignment matches Capital's.
  useEffect(() => {
    const series = seriesRef.current;
    const last = lastBarRef.current;
    if (!series || last === null || liveMid === null || !Number.isFinite(liveMid)) return;
    if (liveTime === null || !Number.isFinite(liveTime)) return;

    const duration = RESOLUTION_SECONDS[resolution] ?? 3600;
    const tickSec = toSeconds(liveTime);
    const delta = tickSec - last.time;

    let updated: Bar;
    if (delta < duration) {
      // Same interval → extend the current candle.
      updated = {
        ...last,
        close: liveMid,
        high: Math.max(last.high, liveMid),
        low: Math.min(last.low, liveMid),
      };
    } else {
      // New interval → open a fresh candle at the aligned slot.
      const newTime = last.time + Math.floor(delta / duration) * duration;
      updated = { time: newTime, open: liveMid, high: liveMid, low: liveMid, close: liveMid };
    }

    lastBarRef.current = updated;
    series.update({
      time: updated.time as UTCTimestamp,
      open: updated.open,
      high: updated.high,
      low: updated.low,
      close: updated.close,
    });
  }, [liveMid, liveTime, resolution]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
