import React from 'react';
import { BarChart2, LayoutDashboard, ListTree, Activity, Radar, Settings, Flame, ShieldAlert, Cpu } from 'lucide-react';
import './_terminal.css';

export function TerminalPro() {
  return (
    <div className="terminal-bg w-full h-screen min-h-[800px] flex overflow-hidden text-sm selection:bg-blue-500/30">
      <div className="terminal-grid"></div>
      <div className="terminal-scanlines"></div>

      {/* Sidebar */}
      <aside className="terminal-sidebar w-56 flex-shrink-0 flex flex-col relative z-20 h-full">
        <div className="h-16 flex items-center px-6 border-b border-blue-500/10">
          <BarChart2 className="text-electric w-5 h-5 mr-3" />
          <span className="font-bold tracking-[0.2em] text-white">TRADEBUZZ</span>
        </div>

        <div className="flex-1 py-6 flex flex-col gap-1">
          <NavItem icon={<LayoutDashboard size={16} />} label="DASHBOARD" active />
          <NavItem icon={<ListTree size={16} />} label="TRADES" />
          <NavItem icon={<Activity size={16} />} label="SIGNALS" />
          <NavItem icon={<Radar size={16} />} label="SCANNER" />
          <NavItem icon={<BarChart2 size={16} />} label="INSTRUMENTS" />
        </div>

        <div className="mt-auto">
          <div className="py-2 flex flex-col gap-1">
             <NavItem icon={<Settings size={16} />} label="SETTINGS" />
          </div>
          <div className="p-6 border-t border-blue-500/10">
            <p className="font-jetbrains text-[10px] text-slate-500 leading-relaxed uppercase opacity-70">
              v1.0.0<br/>
              © 2026 ClinAITech Ltd<br/>
              United Kingdom
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative z-20 overflow-y-auto overflow-x-hidden">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-blue-500/10 bg-[#0a0f1a]/80 backdrop-blur sticky top-0 z-30">
          <h1 className="text-lg font-light tracking-[0.25em] text-slate-300">DASHBOARD</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center px-3 py-1 border border-red-500/50 bg-red-500/5 rounded-[2px] text-xs font-medium text-red-400 tracking-wider">
              <ShieldAlert size={14} className="mr-2" />
              BOT STOPPED • DRY RUN
            </div>
          </div>
        </header>

        <div className="p-8 flex flex-col gap-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard 
              label="ACCOUNT VALUE" 
              value="£1,269.00" 
              valueColor="text-white"
            />
            <StatCard 
              label="INVESTED" 
              value="£1,431.70" 
              valueColor="text-slate-300"
            />
            <StatCard 
              label="TOTAL P&L" 
              value="-£162.70" 
              valueColor="text-neg"
            />
          </div>

          {/* Two-Column Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Live Positions */}
            <div className="flex flex-col gap-4">
              <h2 className="text-xs font-light tracking-[0.2em] text-slate-400 uppercase">LIVE POSITIONS</h2>
              <div className="terminal-card p-0 flex flex-col">
                <PositionRow 
                  ticker="OIL_CRUDE" 
                  units={200} 
                  avgPrice={76.21} 
                  pnl={207.20} 
                  pnlPercent={1.36}
                  isPositive={true}
                />
              </div>
            </div>

            {/* Recent Signals */}
            <div className="flex flex-col gap-4">
              <h2 className="text-xs font-light tracking-[0.2em] text-slate-400 uppercase">RECENT SIGNALS</h2>
              <div className="terminal-card p-0 flex flex-col">
                <SignalRow ticker="US500" signal="HOLD" price={5123.40} ma="SMA20 > SMA50" />
                <SignalRow ticker="OIL_CRUDE" signal="HOLD" price={77.05} ma="Price < EMA20" />
                <SignalRow ticker="PL" signal="HOLD" price={912.10} ma="RSI Neutral" />
                <SignalRow ticker="MSFT" signal="HOLD" price={415.20} ma="SMA20 > SMA50" />
                <SignalRow ticker="NVDA" signal="HOLD" price={875.12} ma="Price > EMA20" />
              </div>
            </div>
          </div>

          {/* Market News */}
          <div className="flex flex-col gap-4">
            <h2 className="text-xs font-light tracking-[0.2em] text-slate-400 uppercase flex items-center gap-2">
              <Flame size={14} className="text-orange-500" />
              MARKET-MOVING NEWS
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <NewsCard 
                headline="Fed Signals Potential Rate Cuts Later This Year Amid Cooling Inflation"
                source="Reuters"
                time="10m ago"
                impact="HIGH"
              />
              <NewsCard 
                headline="Crude Oil Inventories Rise Unexpectedly, Pressuring Energy Sector"
                source="Bloomberg"
                time="45m ago"
                impact="MEDIUM"
              />
              <NewsCard 
                headline="Tech Giants Prepare for Next Wave of AI Infrastructure Investments"
                source="WSJ"
                time="2h ago"
                impact="HIGH"
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <a href="#" className={`terminal-nav-item flex items-center px-6 py-3 text-sm font-light tracking-wider text-slate-400 ${active ? 'active' : ''}`}>
      <span className={`mr-3 ${active ? 'text-electric' : 'opacity-70'}`}>{icon}</span>
      {label}
    </a>
  );
}

function StatCard({ label, value, valueColor }: { label: string, value: string, valueColor: string }) {
  return (
    <div className="terminal-card p-6 flex flex-col justify-center">
      <h3 className="text-xs font-light tracking-[0.15em] text-slate-500 uppercase mb-2">{label}</h3>
      <div className={`font-jetbrains text-3xl font-medium tabular-nums ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}

function PositionRow({ ticker, units, avgPrice, pnl, pnlPercent, isPositive }: { ticker: string, units: number, avgPrice: number, pnl: number, pnlPercent: number, isPositive: boolean }) {
  return (
    <div className="px-5 py-4 border-b border-blue-500/10 last:border-0 flex items-center justify-between group hover:bg-blue-500/5 transition-colors">
      <div className="flex items-center gap-4">
        <div className="font-bold tracking-wider text-white">{ticker}</div>
        <div className="font-jetbrains text-slate-400 text-xs tabular-nums">{units} units</div>
        <div className="font-jetbrains text-slate-400 text-xs tabular-nums">Avg £{avgPrice.toFixed(2)}</div>
      </div>
      <div className={`font-jetbrains text-right tabular-nums flex flex-col items-end ${isPositive ? 'text-pos' : 'text-neg'}`}>
        <span className="font-medium">{isPositive ? '+' : '-'}£{Math.abs(pnl).toFixed(2)}</span>
        <span className="text-xs opacity-80">{isPositive ? '+' : ''}{pnlPercent.toFixed(2)}%</span>
      </div>
    </div>
  );
}

function SignalRow({ ticker, signal, price, ma }: { ticker: string, signal: string, price: number, ma: string }) {
  return (
    <div className="px-5 py-3 border-b border-blue-500/10 last:border-0 flex items-center justify-between group hover:bg-blue-500/5 transition-colors">
      <div className="flex items-center gap-4 w-1/3">
        <div className="font-bold tracking-wider text-white">{ticker}</div>
      </div>
      <div className="w-1/4">
        <span className="px-2 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-bold tracking-wider uppercase rounded-sm">
          {signal}
        </span>
      </div>
      <div className="font-jetbrains text-slate-300 tabular-nums w-1/4 text-right">
        {price.toFixed(2)}
      </div>
      <div className="font-jetbrains text-slate-500 text-xs text-right w-1/4 truncate" title={ma}>
        {ma}
      </div>
    </div>
  );
}

function NewsCard({ headline, source, time, impact }: { headline: string, source: string, time: string, impact: string }) {
  return (
    <div className="terminal-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <span className={`px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded-sm border ${
          impact === 'HIGH' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        }`}>
          {impact}
        </span>
        <span className="font-jetbrains text-[10px] text-slate-500 whitespace-nowrap">{time}</span>
      </div>
      <h3 className="text-sm font-medium text-slate-200 leading-relaxed line-clamp-3">
        {headline}
      </h3>
      <div className="font-jetbrains text-[10px] text-slate-500 uppercase mt-auto pt-2 border-t border-blue-500/10">
        SOURCE: <span className="text-electric">{source}</span>
      </div>
    </div>
  );
}

export default TerminalPro;
