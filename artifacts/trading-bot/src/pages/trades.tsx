import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTrades,
  getListTradesQueryKey,
  useListInstruments,
  getListInstrumentsQueryKey,
  useGetBotStatus,
  getGetBotStatusQueryKey,
  useExecuteTrade,
  useGetQuote,
  getGetQuoteQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";

const BROKER_LABELS: Record<string, string> = {
  trading212: "Trading 212",
  capitalcom: "Capital.com",
};

function ManualTradePanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: instruments } = useListInstruments({
    query: { queryKey: getListInstrumentsQueryKey() },
  });
  const { data: botStatus } = useGetBotStatus({
    query: { queryKey: getGetBotStatusQueryKey() },
  });

  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("100");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dryRun = botStatus?.config.dryRun ?? true;
  const broker = botStatus?.config.broker ?? "capitalcom";
  const brokerLabel = BROKER_LABELS[broker] ?? broker;
  const amountNum = Number(amount);

  const trimmedTicker = ticker.trim();
  const {
    data: quote,
    isFetching: quoteFetching,
    isError: quoteError,
  } = useGetQuote(
    { ticker: trimmedTicker },
    {
      query: {
        queryKey: getGetQuoteQueryKey({ ticker: trimmedTicker }),
        enabled: trimmedTicker.length > 0,
        refetchInterval: 5000,
        retry: false,
      },
    }
  );

  const marketClosed = quote?.marketStatus != null && quote.marketStatus !== "TRADEABLE";
  const estimatedUnits =
    quote && quote.price > 0 && amountNum > 0 ? amountNum / quote.price : null;
  const canSubmit = trimmedTicker.length > 0 && amountNum > 0;

  const executeMutation = useExecuteTrade({
    mutation: {
      onSuccess: (trade) => {
        queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
        if (trade.status === "FAILED") {
          toast({
            title: "Trade rejected by broker",
            description: trade.errorMessage ?? "The order could not be filled.",
            variant: "destructive",
          });
        } else if (trade.status === "DRY_RUN") {
          toast({
            title: "Dry run — order simulated",
            description: `${trade.side} ${trade.ticker} logged without sending to the broker.`,
          });
        } else {
          toast({
            title: "Trade executed",
            description: `${trade.side} ${trade.ticker} filled via ${brokerLabel}.`,
          });
        }
      },
      onError: (err: any) => {
        toast({
          title: "Could not execute trade",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const submit = () => {
    setConfirmOpen(false);
    executeMutation.mutate({
      data: { ticker: ticker.trim(), side, amount: amountNum },
    });
  };

  return (
    <div className="p-5 md:p-6 rounded-lg" style={{ backgroundColor: card, border: cardBorder }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Manual Trade</h2>
          <p className="text-xs mt-1" style={{ color: muted }}>
            Places a market order through your configured broker.
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            dryRun
              ? "text-amber-500 border-amber-500 bg-amber-500/10"
              : "text-destructive border-destructive bg-destructive/10"
          }
        >
          {dryRun ? "DRY RUN" : "LIVE"} · {brokerLabel}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr_auto] md:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: muted }}>Instrument</Label>
          {instruments && instruments.length > 0 ? (
            <Select value={ticker} onValueChange={setTicker}>
              <SelectTrigger>
                <SelectValue placeholder="Select instrument" />
              </SelectTrigger>
              <SelectContent>
                {instruments.map((i) => (
                  <SelectItem key={i.id} value={i.ticker}>
                    {i.ticker} — {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              placeholder="e.g. GOLD"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: muted }}>Side</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={side === "BUY" ? "default" : "outline"}
              onClick={() => setSide("BUY")}
              className={side === "BUY" ? "bg-primary text-primary-foreground" : ""}
            >
              Buy
            </Button>
            <Button
              type="button"
              variant={side === "SELL" ? "default" : "outline"}
              onClick={() => setSide("SELL")}
              className={side === "SELL" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              Sell
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: muted }}>Amount (trade value)</Label>
          <Input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <Button
          type="button"
          disabled={!canSubmit || executeMutation.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {executeMutation.isPending ? "Executing…" : "Execute"}
        </Button>
      </div>

      {trimmedTicker.length > 0 && (
        <div
          className="mt-4 p-3 rounded-md flex flex-wrap items-center gap-x-6 gap-y-2"
          style={{ backgroundColor: "rgba(255,255,255,0.02)", border: cardBorder }}
        >
          {quoteError ? (
            <span className="text-xs text-destructive">
              Live price unavailable for {trimmedTicker}.
            </span>
          ) : !quote ? (
            <span className="text-xs" style={{ color: muted }}>
              {quoteFetching ? "Fetching live price…" : "—"}
            </span>
          ) : (
            <>
              <PriceStat label="Bid" value={fmtPrice(quote.bid)} />
              <PriceStat label="Offer" value={fmtPrice(quote.offer)} />
              <PriceStat
                label="Mid"
                value={`${fmtPrice(quote.price)}${quote.currency ? " " + quote.currency : ""}`}
                emphasis
              />
              {estimatedUnits != null && (
                <PriceStat label="Est. units" value={fmtUnits(estimatedUnits)} />
              )}
              <div className="flex items-center gap-2 ml-auto">
                {quote.marketStatus && (
                  <Badge
                    variant="outline"
                    className={
                      marketClosed
                        ? "text-amber-500 border-amber-500 bg-amber-500/10"
                        : "text-primary border-primary bg-primary/10"
                    }
                  >
                    {quote.marketStatus}
                  </Badge>
                )}
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: muted }}
                >
                  {quoteFetching ? "Updating…" : "Live · 5s"}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dryRun ? "Confirm simulated trade" : "Confirm live trade"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-mono font-semibold">{side}</span>{" "}
                  <span className="font-mono font-semibold">{ticker}</span> for{" "}
                  <span className="font-mono font-semibold">{amountNum}</span> via{" "}
                  <span className="font-semibold">{brokerLabel}</span>.
                </div>
                {quote && (
                  <div className="text-xs" style={{ color: muted }}>
                    Live mid {fmtPrice(quote.price)}
                    {quote.currency ? " " + quote.currency : ""}
                    {estimatedUnits != null && <> · ≈ {fmtUnits(estimatedUnits)} units</>}
                    {marketClosed && (
                      <span className="text-amber-500"> · market {quote.marketStatus}</span>
                    )}
                  </div>
                )}
                {quoteError && (
                  <div className="text-xs text-amber-500">
                    Live price unavailable — order will be sized at the broker's latest price.
                  </div>
                )}
                {dryRun ? (
                  <div className="text-amber-500">
                    Dry Run is ON — this order will be logged but NOT sent to the broker.
                  </div>
                ) : (
                  <div className="text-destructive font-medium">
                    Dry Run is OFF — this will place a real order with real money.
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={submit}>
              {dryRun ? "Simulate" : "Place order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function fmtPrice(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

function fmtUnits(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function PriceStat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: muted }}>
        {label}
      </span>
      <span className={`font-mono ${emphasis ? "text-base font-semibold" : "text-sm"}`}>
        {value}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "FILLED" ? "text-primary border-primary bg-primary/10" :
    status === "FAILED" ? "text-destructive border-destructive bg-destructive/10" :
    "text-amber-500 border-amber-500 bg-amber-500/10";
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}

type TradeFilter = "all" | "live" | "dry";

const isDryRun = (status: string) => status === "DRY_RUN";

export default function Trades() {
  const { data: trades, isLoading } = useListTrades(undefined, {
    query: { queryKey: getListTradesQueryKey() }
  });

  const [filter, setFilter] = useState<TradeFilter>("all");

  const dryCount = trades?.filter((t) => isDryRun(t.status)).length ?? 0;
  const liveCount = (trades?.length ?? 0) - dryCount;

  const filteredTrades = (trades ?? []).filter((t) =>
    filter === "all" ? true : filter === "dry" ? isDryRun(t.status) : !isDryRun(t.status)
  );

  const FILTERS: { value: TradeFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: trades?.length ?? 0 },
    { value: "live", label: "Live", count: liveCount },
    { value: "dry", label: "Dry Run", count: dryCount },
  ];

  return (
    <div className="space-y-6 md:space-y-8">
      <h1 className="text-2xl md:text-4xl font-light tracking-tight">Trades</h1>

      <ManualTradePanel />

      <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
        <h2 className="text-lg md:text-xl font-light tracking-tight">History</h2>
        {trades && trades.length > 0 && (
          <div className="inline-flex rounded-lg p-0.5" style={{ backgroundColor: card, border: cardBorder }}>
            {FILTERS.map((f) => {
              const active = filter === f.value;
              const isDry = f.value === "dry";
              return (
                <button
                  key={f.value}
                  type="button"
                  data-testid={`filter-trades-${f.value}`}
                  onClick={() => setFilter(f.value)}
                  className={[
                    "px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5",
                    active
                      ? isDry
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <span className="font-medium">{f.label}</span>
                  <span className="tabular-nums opacity-70">{f.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : !trades || trades.length === 0 ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          No trades found.
        </div>
      ) : filteredTrades.length === 0 ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          No {filter === "dry" ? "dry-run" : "live"} trades yet.
        </div>
      ) : (
        <>
          {/* ── Mobile card list (hidden on md+) ── */}
          <div className="md:hidden space-y-3">
            {filteredTrades.map((trade) => {
              const buy = trade.side === "BUY";
              return (
                <div key={trade.id} className="p-4 rounded-lg" style={{ backgroundColor: card, border: cardBorder }}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-semibold text-sm">{trade.ticker}</div>
                      <div className="text-xs mt-0.5" style={{ color: muted }}>
                        {new Date(trade.executedAt).toLocaleString()}
                      </div>
                    </div>
                    <StatusBadge status={trade.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-3 pt-3" style={{ borderTop: divider }}>
                    <div>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Side</div>
                      <div className={`text-sm font-semibold font-mono mt-0.5 ${buy ? "text-primary" : "text-destructive"}`}>
                        {trade.side}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Qty</div>
                      <div className="text-sm font-mono mt-0.5">{trade.quantity}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Price</div>
                      <div className="text-sm font-mono mt-0.5">{trade.price.toFixed(2)}</div>
                    </div>
                  </div>
                  {trade.total != null && (
                    <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: divider }}>
                      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>Total</span>
                      <span className="text-sm font-mono font-medium">{trade.total.toFixed(2)}</span>
                    </div>
                  )}
                  {trade.aiReason && (
                    <div className="mt-2 pt-2" style={{ borderTop: divider }}>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: muted }}>
                        AI Reason{trade.aiConfidence ? ` · ${trade.aiConfidence}` : ""}
                      </div>
                      <div className="text-xs mt-1">{trade.aiReason}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Desktop table (hidden on mobile) ── */}
          <div className="hidden md:block rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr style={{ borderBottom: divider }}>
                    {["Time", "Ticker", "Side", "Qty", "Price", "Total", "Status", "AI Reason"].map((h) => (
                      <th key={h} className="px-5 py-4">
                        <SectionLabel>{h}</SectionLabel>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {filteredTrades.map((trade, idx) => (
                    <tr
                      key={trade.id}
                      style={idx < filteredTrades.length - 1 ? { borderBottom: divider } : {}}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "hsl(var(--accent))")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                    >
                      <td className="px-5 py-4 whitespace-nowrap text-xs" style={{ color: muted }}>
                        {new Date(trade.executedAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 font-bold">{trade.ticker}</td>
                      <td className={`px-5 py-4 font-semibold ${trade.side === "BUY" ? "text-primary" : "text-destructive"}`}>
                        {trade.side}
                      </td>
                      <td className="px-5 py-4">{trade.quantity}</td>
                      <td className="px-5 py-4">{trade.price.toFixed(2)}</td>
                      <td className="px-5 py-4">{trade.total ? trade.total.toFixed(2) : "—"}</td>
                      <td className="px-5 py-4"><StatusBadge status={trade.status} /></td>
                      <td className="px-5 py-4 font-sans text-xs max-w-xs whitespace-normal" style={{ color: muted }}>
                        {trade.aiReason
                          ? <>{trade.aiConfidence && <span className="uppercase tracking-wider mr-1 opacity-70">[{trade.aiConfidence}]</span>}{trade.aiReason}</>
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
