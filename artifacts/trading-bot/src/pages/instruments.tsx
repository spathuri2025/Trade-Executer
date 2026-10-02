import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInstruments,
  getListInstrumentsQueryKey,
  useAddInstrument,
  useDeleteInstrument,
  useUpdateInstrument,
  useSearchInstruments,
  getSearchInstrumentsQueryKey,
  type InstrumentMatch,
  useGetPlan,
  getGetPlanQueryKey
} from "@workspace/api-client-react";
import { RequestUpgradeButton } from "@/components/RequestUpgradeButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Instruments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<InstrumentMatch | null>(null);

  const { data: instruments, isLoading } = useListInstruments({
    query: { queryKey: getListInstrumentsQueryKey() }
  });

  // Debounced so a search box does not issue a broker-catalogue request per
  // keystroke; the catalogue itself is cached server-side for six hours.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const search = useSearchInstruments(
    { q: debounced },
    { query: { queryKey: getSearchInstrumentsQueryKey({ q: debounced }), enabled: debounced.length > 1, retry: false } }
  );

  const { data: planStatus } = useGetPlan({ query: { queryKey: getGetPlanQueryKey() } });
  // null means the plan is uncapped — the API sends null rather than Infinity,
  // which isn't valid JSON.
  const instrumentCap = planStatus?.limits.maxInstruments ?? null;
  const instrumentsUsed = planStatus?.usage.instruments ?? instruments?.length ?? 0;
  const atInstrumentCap = instrumentCap != null && instrumentsUsed >= instrumentCap;

  const addMutation = useAddInstrument({
    mutation: {
      onSuccess: () => {
        setQuery("");
        setPicked(null);
        queryClient.invalidateQueries({ queryKey: getListInstrumentsQueryKey() });
        // Keep the plan's "instruments used" counter in step with the new total.
        queryClient.invalidateQueries({ queryKey: getGetPlanQueryKey() });
        toast({ title: "Instrument added successfully" });
      },
      onError: (err: any) => {
        // A plan-cap rejection (402) carries its explanation in the response
        // body, which isn't always surfaced as err.message — check the usual
        // shapes so the user sees the real reason rather than a bare "failed".
        const serverMessage =
          err?.response?.data?.error ?? err?.data?.error ?? err?.error ?? err?.message;
        toast({
          title: "Failed to add instrument",
          description: serverMessage,
          variant: "destructive",
        });
      }
    }
  });

  const deleteMutation = useDeleteInstrument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInstrumentsQueryKey() });
        // Frees a slot against the plan cap — refresh the counter.
        queryClient.invalidateQueries({ queryKey: getGetPlanQueryKey() });
        toast({ title: "Instrument deleted" });
      }
    }
  });

  const toggleMutation = useUpdateInstrument({
    mutation: {
      onSuccess: (updated) => {
        queryClient.invalidateQueries({ queryKey: getListInstrumentsQueryKey() });
        toast({
          title: `${updated.ticker} ${updated.enabled ? "enabled" : "disabled"}`,
          description: updated.enabled
            ? "The engine will consider it from the next cycle."
            : "It stays in your list with its history, and the engine will skip it from the next cycle.",
        });
      },
      onError: () => toast({ title: "Couldn't change that instrument", variant: "destructive" }),
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    // Only ever an instrument chosen from the broker's own catalogue — the epic
    // is never typed, which is what makes a wrong one impossible rather than
    // merely unlikely.
    if (!picked) return;
    addMutation.mutate({ data: { ticker: picked.epic, name: picked.name, enabled: true } });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Watchlist</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <CollapsibleSection
          id="instruments.add"
          title="Add Instrument"
          defaultOpen={false}
          description={<>{instrumentCap == null
                ? "Track a new ticker"
                : `Tracking ${instrumentsUsed} of ${instrumentCap} on your plan`}</>}
          className="md:col-span-1 h-fit"
        >
            {atInstrumentCap && (
              <div className="text-xs rounded-md p-3 mb-4 border border-border bg-muted/30 text-muted-foreground space-y-2">
                <p>
                  You're tracking the maximum {instrumentCap} instruments your plan allows. Remove
                  one to add another, or upgrade to track more.
                </p>
                <RequestUpgradeButton trigger="instrument_cap" />
              </div>
            )}
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Search instruments</label>
                <Input
                  placeholder="e.g. crude oil, gold, Apple"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPicked(null);
                  }}
                  data-testid="input-instrument-search"
                />
                <p className="text-xs text-muted-foreground">
                  Searches your broker&rsquo;s own catalogue. The watchlist stores the identifier Capital.com
                  uses, which matches the ticker for shares and does not for anything else &mdash; crude oil is{" "}
                  <span className="font-mono">OIL_CRUDE</span>. Picking from this list is the only way to be
                  sure it is right: a wrong one looks fine here and silently never trades.
                </p>
              </div>

              {search.isFetching && query.trim().length > 0 && (
                <p className="text-xs text-muted-foreground">Searching&hellip;</p>
              )}

              {search.isError && (
                <p className="text-xs text-destructive" data-testid="search-error">
                  {(search.error as { data?: { error?: string } })?.data?.error ??
                    "Couldn't search your broker's instruments."}
                </p>
              )}

              {!picked && (search.data?.length ?? 0) > 0 && (
                <div className="max-h-56 overflow-y-auto divide-y divide-border rounded-md border border-border">
                  {search.data!.map((m) => (
                    <button
                      key={m.epic}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-muted/40"
                      onClick={() => setPicked(m)}
                      data-testid={`search-result-${m.epic}`}
                    >
                      <div className="font-mono text-sm">{m.epic}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.name} &middot; {m.instrumentType.toLowerCase()}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!picked && !search.isFetching && query.trim().length > 1 && (search.data?.length ?? 0) === 0 && !search.isError && (
                <p className="text-xs text-muted-foreground">Nothing matched. Try fewer words.</p>
              )}

              {picked && (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-1" data-testid="picked-instrument">
                  <div className="font-mono text-sm">{picked.epic}</div>
                  <div className="text-xs text-muted-foreground">
                    {picked.name} &middot; {picked.instrumentType.toLowerCase()}
                  </div>
                  <p className="text-xs text-muted-foreground pt-1">
                    Counts towards your <span className="font-medium">{picked.instrumentType.toLowerCase()}</span>{" "}
                    exposure, which has its own net-direction limit.
                  </p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={addMutation.isPending || atInstrumentCap || !picked}
              >
                {addMutation.isPending ? "Adding..." : picked ? `Add ${picked.epic}` : "Pick an instrument above"}
              </Button>
            </form>
        </CollapsibleSection>

        <CollapsibleSection
          id="instruments.list"
          title="Tracked Instruments"
          className="md:col-span-2"
        >
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : instruments && instruments.length > 0 ? (
              <div className="divide-y divide-border">
                {instruments.map((inst) => (
                  <div key={inst.id} className="py-3 flex justify-between items-center group">
                    <div>
                      <div className="font-bold font-mono">{inst.ticker}</div>
                      <div className="text-sm text-muted-foreground">{inst.name}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {inst.enabled ? "Enabled" : "Disabled"}
                        </span>
                        <Switch
                          checked={inst.enabled}
                          onCheckedChange={(enabled) =>
                            toggleMutation.mutate({ id: inst.id, data: { enabled } })
                          }
                          disabled={toggleMutation.isPending}
                          aria-label={`${inst.enabled ? "Disable" : "Enable"} ${inst.ticker}`}
                          data-testid={`toggle-instrument-${inst.ticker}`}
                        />
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => deleteMutation.mutate({ id: inst.id })}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No instruments in watchlist.
              </div>
            )}
        </CollapsibleSection>
      </div>
    </div>
  );
}
