import { useRiskStatus, useUpdateRiskLimits } from "@/lib/engineApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export default function Risk() {
  const { data: riskStatus, isLoading } = useRiskStatus();
  const updateRisk = useUpdateRiskLimits();
  
  const [limits, setLimits] = useState({
    max_daily_loss_pct: 0,
    max_weekly_loss_pct: 0,
    max_drawdown_pct: 0,
    max_position_size_pct: 0,
    max_trades_per_day: 0,
    require_stop_loss: true
  });

  useEffect(() => {
    if (riskStatus?.risk_limits) {
      setLimits({
        max_daily_loss_pct: riskStatus.risk_limits.max_daily_loss_pct || 0,
        max_weekly_loss_pct: riskStatus.risk_limits.max_weekly_loss_pct || 0,
        max_drawdown_pct: riskStatus.risk_limits.max_drawdown_pct || 0,
        max_position_size_pct: riskStatus.risk_limits.max_position_size_pct || 0,
        max_trades_per_day: riskStatus.risk_limits.max_trades_per_day || 0,
        require_stop_loss: riskStatus.risk_limits.require_stop_loss ?? true
      });
    }
  }, [riskStatus]);

  const handleSave = () => {
    updateRisk.mutate(limits, {
      onSuccess: () => toast.success("Risk limits updated successfully"),
      onError: (err) => toast.error("Failed to update limits", { description: err.message })
    });
  };

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Risk Management</h2>
        <p className="text-muted-foreground">Global circuit breakers and safety limits.</p>
      </div>

      {riskStatus?.emergency_stop_active && (
        <div className="bg-destructive/10 border border-destructive rounded-lg p-6 flex items-start gap-4">
          <AlertTriangle className="w-8 h-8 text-destructive shrink-0" />
          <div>
            <h3 className="text-lg font-bold text-destructive">EMERGENCY STOP ACTIVE</h3>
            <p className="text-destructive/80 mt-1">{riskStatus.emergency_stop_reason || "Operator manually engaged emergency stop."}</p>
            <p className="text-sm mt-2">Clear the emergency stop from the top navigation bar to resume operations.</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Global Risk Limits
          </CardTitle>
          <CardDescription>These hard limits override all individual strategy settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Max Daily Loss (%)</Label>
              <div className="relative">
                <Input 
                  type="number" 
                  value={limits.max_daily_loss_pct} 
                  onChange={e => setLimits({...limits, max_daily_loss_pct: parseFloat(e.target.value) || 0})}
                  className="font-mono bg-background"
                />
              </div>
              <p className="text-xs text-muted-foreground">Halts trading for 24h if reached</p>
            </div>
            
            <div className="space-y-2">
              <Label>Max Weekly Loss (%)</Label>
              <Input 
                type="number" 
                value={limits.max_weekly_loss_pct} 
                onChange={e => setLimits({...limits, max_weekly_loss_pct: parseFloat(e.target.value) || 0})}
                className="font-mono bg-background"
              />
              <p className="text-xs text-muted-foreground">Halts trading until Monday UTC</p>
            </div>

            <div className="space-y-2">
              <Label>Max Drawdown (%)</Label>
              <Input 
                type="number" 
                value={limits.max_drawdown_pct} 
                onChange={e => setLimits({...limits, max_drawdown_pct: parseFloat(e.target.value) || 0})}
                className="font-mono bg-background"
              />
              <p className="text-xs text-muted-foreground">From absolute peak balance</p>
            </div>

            <div className="space-y-2">
              <Label>Max Position Size (%)</Label>
              <Input 
                type="number" 
                value={limits.max_position_size_pct} 
                onChange={e => setLimits({...limits, max_position_size_pct: parseFloat(e.target.value) || 0})}
                className="font-mono bg-background"
              />
              <p className="text-xs text-muted-foreground">Max capital per single trade</p>
            </div>
            
            <div className="space-y-2">
              <Label>Max Trades Per Day</Label>
              <Input 
                type="number" 
                value={limits.max_trades_per_day} 
                onChange={e => setLimits({...limits, max_trades_per_day: parseInt(e.target.value) || 0})}
                className="font-mono bg-background"
              />
              <p className="text-xs text-muted-foreground">Across all strategies combined</p>
            </div>

            <div className="space-y-2 flex flex-col justify-center border rounded-md p-4 bg-muted/20">
              <div className="flex items-center justify-between">
                <Label>Require Stop Loss</Label>
                <Switch 
                  checked={limits.require_stop_loss} 
                  onCheckedChange={v => setLimits({...limits, require_stop_loss: v})}
                />
              </div>
              <p className="text-xs text-muted-foreground">Reject orders without a hard stop</p>
            </div>
          </div>

          <div className="pt-6 flex justify-end">
            <Button onClick={handleSave} disabled={updateRisk.isPending}>
              {updateRisk.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save Risk Limits
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
