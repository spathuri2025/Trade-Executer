import { useState } from "react";
import { useStrategies, useUpdateStrategy, useDeleteStrategy, useCreateStrategy } from "@/lib/engineApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Settings2, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Strategies() {
  const { data: strategies, isLoading } = useStrategies();
  const updateStrategy = useUpdateStrategy();
  const deleteStrategy = useDeleteStrategy();
  const createStrategy = useCreateStrategy();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editingStrategy, setEditingStrategy] = useState<any | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleToggle = (id: number, currentActive: boolean) => {
    updateStrategy.mutate({ id, data: { is_active: !currentActive } }, {
      onSuccess: () => toast.success(`Strategy ${!currentActive ? 'activated' : 'deactivated'}`),
      onError: (err) => toast.error("Failed to update strategy", { description: err.message })
    });
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteStrategy.mutate({ id: deleteId }, {
      onSuccess: () => {
        toast.success("Strategy deleted");
        setDeleteId(null);
      },
      onError: (err) => toast.error("Failed to delete", { description: err.message })
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Strategies</h2>
          <p className="text-muted-foreground">Manage trading algorithms and their parameters.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> New Strategy
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : strategies?.length === 0 ? (
          <Card className="col-span-full"><CardContent className="p-8 text-center text-muted-foreground">No strategies configured.</CardContent></Card>
        ) : (
          strategies?.map(strategy => (
            <Card key={strategy.id} className={`transition-all ${strategy.is_active ? 'border-primary/50 shadow-[0_0_15px_rgba(0,200,255,0.05)]' : 'opacity-70'}`}>
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{strategy.name}</CardTitle>
                    <CardDescription className="font-mono mt-1">{strategy.symbol} • {strategy.timeframe}</CardDescription>
                  </div>
                  <Switch 
                    checked={strategy.is_active} 
                    onCheckedChange={() => handleToggle(strategy.id, strategy.is_active)} 
                    disabled={updateStrategy.isPending}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Stop Loss</p>
                    <p className="text-sm font-mono text-red-400">-{strategy.stop_loss_pct}%</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Take Profit</p>
                    <p className="text-sm font-mono text-green-400">+{strategy.take_profit_pct}%</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Max Trades/Day</p>
                    <p className="text-sm font-mono">{strategy.max_trades_per_day}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Min Conf</p>
                    <p className="text-sm font-mono">{(strategy.confidence_threshold * 100).toFixed(0)}%</p>
                  </div>
                </div>
                
                <div className="flex justify-end gap-2 border-t border-border pt-4">
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setEditingStrategy(strategy)}>
                    <Settings2 className="w-4 h-4 mr-2" /> Edit
                  </Button>
                  <Button variant="outline" size="icon" className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20" onClick={() => setDeleteId(strategy.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="dark bg-card border-destructive">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Strategy?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The strategy will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteStrategy.isPending}>
              {deleteStrategy.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StrategyModal 
        isOpen={isCreateOpen || !!editingStrategy} 
        onClose={() => { setIsCreateOpen(false); setEditingStrategy(null); }} 
        strategy={editingStrategy} 
        createStrategy={createStrategy}
        updateStrategy={updateStrategy}
      />
    </div>
  );
}

function StrategyModal({ isOpen, onClose, strategy, createStrategy, updateStrategy }: any) {
  const [formData, setFormData] = useState({
    name: "",
    symbol: "",
    market: "CRYPTO",
    timeframe: "1m",
    stop_loss_pct: 1.0,
    take_profit_pct: 2.0,
    max_trades_per_day: 5,
    confidence_threshold: 0.8
  });

  // reset or populate form when modal opens
  useState(() => {
    if (strategy) {
      setFormData({
        name: strategy.name,
        symbol: strategy.symbol,
        market: strategy.market,
        timeframe: strategy.timeframe,
        stop_loss_pct: strategy.stop_loss_pct,
        take_profit_pct: strategy.take_profit_pct,
        max_trades_per_day: strategy.max_trades_per_day,
        confidence_threshold: strategy.confidence_threshold
      });
    } else {
      setFormData({
        name: "",
        symbol: "BTC/USDT",
        market: "CRYPTO",
        timeframe: "1m",
        stop_loss_pct: 1.0,
        take_profit_pct: 2.0,
        max_trades_per_day: 5,
        confidence_threshold: 0.8
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (strategy) {
      updateStrategy.mutate({ id: strategy.id, data: formData }, {
        onSuccess: () => {
          toast.success("Strategy updated");
          onClose();
        },
        onError: (err: any) => toast.error("Failed to update", { description: err.message })
      });
    } else {
      createStrategy.mutate(formData, {
        onSuccess: () => {
          toast.success("Strategy created");
          onClose();
        },
        onError: (err: any) => toast.error("Failed to create", { description: err.message })
      });
    }
  };

  const isPending = createStrategy.isPending || updateStrategy.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="dark bg-card border-border sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{strategy ? "Edit Strategy" : "New Strategy"}</DialogTitle>
          <DialogDescription>
            {strategy ? "Modify algorithm parameters." : "Define a new trading algorithm setup."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. BTC Scalper" />
            </div>
            <div className="space-y-2">
              <Label>Symbol</Label>
              <Input required value={formData.symbol} onChange={e => setFormData({...formData, symbol: e.target.value})} placeholder="e.g. BTC/USDT" />
            </div>
            <div className="space-y-2">
              <Label>Stop Loss (%)</Label>
              <Input type="number" step="0.1" required value={formData.stop_loss_pct} onChange={e => setFormData({...formData, stop_loss_pct: parseFloat(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>Take Profit (%)</Label>
              <Input type="number" step="0.1" required value={formData.take_profit_pct} onChange={e => setFormData({...formData, take_profit_pct: parseFloat(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>Max Trades / Day</Label>
              <Input type="number" required value={formData.max_trades_per_day} onChange={e => setFormData({...formData, max_trades_per_day: parseInt(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>Min Confidence (0-1)</Label>
              <Input type="number" step="0.01" min="0" max="1" required value={formData.confidence_threshold} onChange={e => setFormData({...formData, confidence_threshold: parseFloat(e.target.value)})} />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : "Save Strategy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
