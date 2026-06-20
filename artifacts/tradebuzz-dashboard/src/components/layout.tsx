import { Link, useLocation } from "wouter";
import { useAuthStatus, useLogout, useBotStatus, useRiskStatus, useEmergencyStop, useClearEmergencyStop } from "@/lib/engineApi";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Activity, ActivityIcon, FileText, Settings, ShieldAlert, LogOut, PowerOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useEffect, useState } from "react";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: auth, isLoading: authLoading } = useAuthStatus();
  const [, setLocation] = useLocation();

  const authenticated = auth?.authenticated;
  useEffect(() => {
    if (!authLoading && !authenticated) {
      setLocation("/login");
    }
  }, [authLoading, authenticated, setLocation]);

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!authenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background dark text-foreground">
      <Sidebar />
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <TopBar />
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function Sidebar() {
  const [location] = useLocation();
  const navItems = [
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/trades", label: "Trades", icon: FileText },
    { href: "/signals", label: "Signals", icon: ActivityIcon },
    { href: "/strategies", label: "Strategies", icon: Settings },
    { href: "/risk", label: "Risk Limits", icon: ShieldCheck },
    { href: "/logs", label: "System Logs", icon: FileText },
  ];

  return (
    <aside className="w-full md:w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-6 border-b border-sidebar-border">
        <h1 className="text-2xl font-bold text-primary tracking-tight">TradeBuzz<span className="text-muted-foreground text-sm font-mono ml-2">v1.0</span></h1>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <span className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors cursor-pointer ${location === item.href ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-sidebar-foreground hover:bg-sidebar-accent/50'}`}>
              <item.icon className="w-5 h-5" />
              {item.label}
            </span>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-sidebar-border">
        <LogoutButton />
      </div>
    </aside>
  );
}

function LogoutButton() {
  const logout = useLogout();
  const [, setLocation] = useLocation();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLocation("/login");
      }
    });
  };

  return (
    <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground" onClick={handleLogout} disabled={logout.isPending}>
      {logout.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LogOut className="w-4 h-4 mr-2" />}
      Disconnect
    </Button>
  );
}

function TopBar() {
  const { data: botStatus } = useBotStatus();
  const { data: riskStatus } = useRiskStatus();
  const emergencyStop = useEmergencyStop();
  const clearEmergencyStop = useClearEmergencyStop();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleEmergencyStop = () => {
    emergencyStop.mutate({ reason: "Manual operator intervention" }, {
      onSuccess: () => {
        toast.error("EMERGENCY STOP ENGAGED", { description: "All active trading halted." });
        setShowConfirm(false);
      }
    });
  };
  
  const handleClearEmergencyStop = () => {
    clearEmergencyStop.mutate(undefined, {
      onSuccess: () => {
        toast.success("Emergency Stop Cleared", { description: "Bot is ready to be restarted." });
      }
    });
  };

  return (
    <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 md:px-8">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground uppercase tracking-wider font-mono">Status:</span>
          {botStatus ? (
            <span className={`px-2 py-0.5 text-xs font-bold rounded-sm ${
              botStatus.state === 'RUNNING' ? 'bg-green-500/20 text-green-400' :
              botStatus.state === 'EMERGENCY_STOP' ? 'bg-destructive/20 text-destructive' :
              botStatus.state === 'PAUSED' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-muted text-muted-foreground'
            }`}>
              {botStatus.state}
            </span>
          ) : (
            <Skeleton className="h-6 w-20" />
          )}
        </div>
        
        {botStatus?.mode && (
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 text-xs font-bold rounded-sm border ${
              botStatus.mode === 'PAPER' ? 'border-blue-500 text-blue-400 bg-blue-500/10' : 'border-destructive text-destructive bg-destructive/10'
            }`}>
              {botStatus.mode} TRADING
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        {riskStatus?.emergency_stop_active ? (
          <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" onClick={handleClearEmergencyStop} disabled={clearEmergencyStop.isPending}>
            {clearEmergencyStop.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            Clear Emergency Stop
          </Button>
        ) : (
          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <Button variant="destructive" onClick={() => setShowConfirm(true)} className="font-bold">
              <PowerOff className="w-4 h-4 mr-2" />
              E-STOP
            </Button>
            <DialogContent className="dark bg-card border-destructive text-foreground">
              <DialogHeader>
                <DialogTitle className="text-destructive flex items-center gap-2 text-xl">
                  <ShieldAlert className="w-6 h-6" />
                  ENGAGE EMERGENCY STOP?
                </DialogTitle>
                <DialogDescription className="text-base mt-4 text-foreground">
                  This will immediately halt all active strategies and cancel open orders. Open positions may require manual intervention to close depending on broker support.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleEmergencyStop} disabled={emergencyStop.isPending}>
                  {emergencyStop.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "CONFIRM E-STOP"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </header>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded-md ${className}`} />;
}
