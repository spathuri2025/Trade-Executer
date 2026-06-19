import { Link, useLocation } from "wouter";
import { LineChart, LayoutDashboard, Activity, ListOrdered, Settings, ScanSearch } from "lucide-react";

export function Sidebar() {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/trades", label: "Trades", icon: ListOrdered },
    { href: "/signals", label: "Signals", icon: Activity },
    { href: "/scanner", label: "Scanner", icon: ScanSearch },
    { href: "/instruments", label: "Instruments", icon: LineChart },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="w-64 border-r border-border bg-sidebar h-screen flex flex-col">
      <div className="p-4 border-b border-border flex items-center gap-2 text-primary font-bold">
        <LineChart className="h-6 w-6" />
        <span>TradeBuzz</span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {links.map((link) => {
          const active = location === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-border text-xs text-muted-foreground space-y-0.5">
        <div className="font-mono">v1.0.0</div>
        <div>&copy; {new Date().getFullYear()} ClinAITech Limited</div>
        <div className="opacity-70">United Kingdom</div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background text-foreground dark">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-background">
        <div className="max-w-7xl mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
