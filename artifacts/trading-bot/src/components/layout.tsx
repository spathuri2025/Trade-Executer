import { Link, useLocation } from "wouter";
import { LineChart, LayoutDashboard, Activity, ListOrdered, Settings, ScanSearch } from "lucide-react";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/signals", label: "Signals", icon: Activity },
  { href: "/scanner", label: "Scanner", icon: ScanSearch },
  { href: "/instruments", label: "Instruments", icon: LineChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div
      className="w-52 flex flex-col h-screen shrink-0"
      style={{ backgroundColor: "#0f0f0f", borderRight: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Logo */}
      <div className="h-24 flex items-center px-8">
        <div className="w-2 h-2 rounded-full bg-primary mr-3 shrink-0" />
        <span className="font-semibold text-lg tracking-wide text-white">TradeBuzz</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 py-2 space-y-0.5">
        {links.map((link) => {
          const active = location === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex items-center gap-3 px-4 py-3 rounded text-sm transition-colors ${
                active
                  ? "text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-primary" />
              )}
              <link.icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-white/30"}`} />
              <span className={active ? "font-medium" : "font-normal"}>{link.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-8">
        <div className="text-[10px] uppercase tracking-widest text-white/30 space-y-0.5">
          <div className="font-mono">v1.0.0</div>
          <div>&copy; {new Date().getFullYear()} ClinAITech Limited</div>
          <div>United Kingdom</div>
        </div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background text-foreground dark">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-background">
        <div className="max-w-5xl mx-auto p-12">
          {children}
        </div>
      </main>
    </div>
  );
}
