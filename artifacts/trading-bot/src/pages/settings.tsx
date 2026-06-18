import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBotStatus,
  getGetBotStatusQueryKey,
  useUpdateBotConfig,
  useStartBot,
  useStopBot
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, Square } from "lucide-react";

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: botStatus, isLoading } = useGetBotStatus(undefined, {
    query: { queryKey: getGetBotStatusQueryKey() }
  });

  const [config, setConfig] = useState({
    shortPeriod: 9,
    longPeriod: 21,
    tradeAmount: 100,
    intervalMinutes: 15,
    dryRun: true
  });

  useEffect(() => {
    if (botStatus?.config) {
      setConfig(botStatus.config);
    }
  }, [botStatus]);

  const updateConfig = useUpdateBotConfig({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        toast({ title: "Configuration saved successfully" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to save configuration", description: err.message, variant: "destructive" });
      }
    }
  });

  const startBot = useStartBot({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        toast({ title: "Bot started" });
      }
    }
  });

  const stopBot = useStopBot({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        toast({ title: "Bot stopped", variant: "destructive" });
      }
    }
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate({ data: config });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Bot Controls & Settings</h1>

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle>Engine Status</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-lg font-bold">
              {botStatus?.running ? (
                <span className="text-primary flex items-center gap-2"><Play className="h-5 w-5" /> RUNNING</span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-2"><Square className="h-5 w-5" /> STOPPED</span>
              )}
            </div>
            {botStatus?.running && (
              <div className="text-sm text-muted-foreground font-mono">
                Next run: {botStatus.nextRunAt ? new Date(botStatus.nextRunAt).toLocaleString() : 'Pending'}
              </div>
            )}
          </div>
          <div>
            {botStatus?.running ? (
              <Button variant="destructive" onClick={() => stopBot.mutate()} disabled={stopBot.isPending}>
                <Square className="mr-2 h-4 w-4" /> Stop Engine
              </Button>
            ) : (
              <Button onClick={() => startBot.mutate()} disabled={startBot.isPending}>
                <Play className="mr-2 h-4 w-4" /> Start Engine
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Strategy Configuration</CardTitle>
          <CardDescription>Moving Average Crossover settings</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6 max-w-xl">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Short MA Period</label>
                <Input 
                  type="number" 
                  value={config.shortPeriod} 
                  onChange={(e) => setConfig({ ...config, shortPeriod: Number(e.target.value) })}
                  className="font-mono"
                  min={1}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Long MA Period</label>
                <Input 
                  type="number" 
                  value={config.longPeriod} 
                  onChange={(e) => setConfig({ ...config, longPeriod: Number(e.target.value) })}
                  className="font-mono"
                  min={2}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Trade Amount</label>
                <Input 
                  type="number" 
                  value={config.tradeAmount} 
                  onChange={(e) => setConfig({ ...config, tradeAmount: Number(e.target.value) })}
                  className="font-mono"
                  min={1}
                  step={0.01}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Interval (Minutes)</label>
                <Input 
                  type="number" 
                  value={config.intervalMinutes} 
                  onChange={(e) => setConfig({ ...config, intervalMinutes: Number(e.target.value) })}
                  className="font-mono"
                  min={1}
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/20">
              <div className="space-y-0.5">
                <label className="text-sm font-medium">Dry Run Mode</label>
                <div className="text-xs text-muted-foreground">
                  Log signals without executing real trades on Trading 212
                </div>
              </div>
              <Switch 
                checked={config.dryRun} 
                onCheckedChange={(checked) => setConfig({ ...config, dryRun: checked })} 
              />
            </div>

            <Button type="submit" disabled={updateConfig.isPending}>
              {updateConfig.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
