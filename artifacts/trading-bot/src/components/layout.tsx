import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LineChart, LayoutDashboard, Activity, ListOrdered, Settings, ScanSearch, MessageSquare, Radar, TrendingUp, Rocket, CandlestickChart, Newspaper, Menu, X, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/signals", label: "Signals", icon: Activity },
  { href: "/scanner", label: "Scanner", icon: ScanSearch },
  { href: "/market-news", label: "Market News", icon: Newspaper },
  { href: "/performance", label: "Performance", icon: TrendingUp },
  { href: "/instruments", label: "Instruments", icon: LineChart },
  { href: "/charts", label: "Charts", icon: CandlestickChart },
  { href: "/assistant", label: "Assistant", icon: MessageSquare },
  { href: "/signal-analyst", label: "Signal Analyst", icon: Radar },
  { href: "/setup", label: "Setup Wizard", icon: Rocket },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="flex-1 px-4 py-2 space-y-0.5">
      {links.map((link) => {
        const active = location === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={`relative flex items-center gap-3 px-4 py-3 rounded text-sm transition-colors ${
              active ? "text-white" : "text-white/55 hover:text-white/80"
            }`}
          >
            {active && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-primary" />
            )}
            <link.icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-white/45"}`} />
            <span className={active ? "font-medium" : "font-normal"}>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="px-8 pb-6 pt-4 space-y-4">
      {user && (
        <div className="flex items-center justify-between gap-2 pb-4 border-t border-white/10 pt-4">
          <span className="text-xs text-white/50 truncate" title={user.email}>
            {user.email}
          </span>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded text-white/40 hover:text-white transition-colors shrink-0"
            aria-label="Log out"
            data-testid="button-logout"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="text-[10px] uppercase tracking-widest text-white/30 space-y-0.5">
        <div className="font-mono">v1.0.0</div>
        <div>&copy; {new Date().getFullYear()} ClinAITech Limited</div>
        <div>United Kingdom</div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sidebarStyle = {
    backgroundColor: "hsl(var(--sidebar))",
    borderColor: "hsl(var(--sidebar-border))",
  };

  return (
    <div className="flex h-screen bg-background text-foreground dark">

      {/* ── Desktop sidebar (hidden on mobile) ── */}
      <aside
        className="hidden md:flex flex-col w-52 h-screen shrink-0 border-r"
        style={sidebarStyle}
      >
        <div className="h-24 flex items-center px-8">
          <div className="w-2 h-2 rounded-full bg-primary mr-3 shrink-0" />
          <span className="font-semibold text-lg tracking-wide text-white">TradeBuzz</span>
        </div>
        <NavLinks />
        <SidebarFooter />
      </aside>

      {/* ── Mobile drawer backdrop ── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Mobile slide-out drawer ── */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-full z-50 w-64 flex flex-col border-r transition-transform duration-300 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={sidebarStyle}
      >
        <div className="h-16 flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
            <span className="font-semibold tracking-wide text-white">TradeBuzz</span>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1.5 rounded text-white/50 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <NavLinks onNavigate={() => setDrawerOpen(false)} />
        <SidebarFooter />
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header
          className="md:hidden flex items-center justify-between px-4 h-14 shrink-0 border-b"
          style={sidebarStyle}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
            <span className="font-semibold tracking-wide text-white">TradeBuzz</span>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded text-white/60 hover:text-white transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        <main className="flex-1 overflow-auto bg-background">
          <div className="max-w-5xl mx-auto px-4 py-6 md:px-8 md:py-8 lg:px-12 lg:py-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
