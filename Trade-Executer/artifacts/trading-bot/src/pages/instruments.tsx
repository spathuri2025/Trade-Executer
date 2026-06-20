import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInstruments,
  getListInstrumentsQueryKey,
  useAddInstrument,
  useDeleteInstrument
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Instruments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");

  const { data: instruments, isLoading } = useListInstruments(undefined, {
    query: { queryKey: getListInstrumentsQueryKey() }
  });

  const addMutation = useAddInstrument({
    mutation: {
      onSuccess: () => {
        setTicker("");
        setName("");
        queryClient.invalidateQueries({ queryKey: getListInstrumentsQueryKey() });
        toast({ title: "Instrument added successfully" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to add instrument", description: err.message, variant: "destructive" });
      }
    }
  });

  const deleteMutation = useDeleteInstrument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInstrumentsQueryKey() });
        toast({ title: "Instrument deleted" });
      }
    }
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !name) return;
    addMutation.mutate({ data: { ticker: ticker.toUpperCase(), name, enabled: true } });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Watchlist</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 h-fit">
          <CardHeader>
            <CardTitle>Add Instrument</CardTitle>
            <CardDescription>Track a new ticker</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Ticker Symbol</label>
                <Input 
                  placeholder="e.g. AAPL" 
                  value={ticker} 
                  onChange={(e) => setTicker(e.target.value)}
                  className="font-mono uppercase"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Company Name</label>
                <Input 
                  placeholder="e.g. Apple Inc." 
                  value={name} 
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={addMutation.isPending}>
                {addMutation.isPending ? "Adding..." : "Add Instrument"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Tracked Instruments</CardTitle>
          </CardHeader>
          <CardContent>
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
                        <Switch checked={inst.enabled} disabled />
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
