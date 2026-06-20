import React from 'react';

export function ObsidianNoir() {
  return (
    <div className="flex h-screen w-full bg-[#080808] text-white font-['Plus_Jakarta_Sans'] selection:bg-[#10b981] selection:text-white">
      {/* Sidebar */}
      <aside className="w-52 flex flex-col border-r shrink-0" style={{ backgroundColor: '#0f0f0f', borderColor: 'rgba(255,255,255,0.06)' }}>
        {/* Logo */}
        <div className="h-24 flex items-center px-8">
          <div className="w-2 h-2 rounded-full bg-[#10b981] mr-3" />
          <span className="font-semibold text-lg tracking-wide">TradeBuzz</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-4 py-4 space-y-1">
          {/* Active */}
          <div className="relative flex items-center px-4 py-3 text-white">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-[#10b981]" />
            <span className="text-sm font-medium">Dashboard</span>
          </div>
          {/* Inactive */}
          <div className="flex items-center px-4 py-3 text-white/40 hover:text-white/70 transition-colors cursor-pointer">
            <span className="text-sm font-medium">Positions</span>
          </div>
          <div className="flex items-center px-4 py-3 text-white/40 hover:text-white/70 transition-colors cursor-pointer">
            <span className="text-sm font-medium">Signals</span>
          </div>
          <div className="flex items-center px-4 py-3 text-white/40 hover:text-white/70 transition-colors cursor-pointer">
            <span className="text-sm font-medium">News</span>
          </div>
          <div className="flex items-center px-4 py-3 text-white/40 hover:text-white/70 transition-colors cursor-pointer">
            <span className="text-sm font-medium">Settings</span>
          </div>
        </nav>

        {/* Footer */}
        <div className="p-8">
          <div className="text-[10px] uppercase tracking-widest text-white/30">
            © 2026 ClinAITech Limited
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-12">
        <div className="max-w-5xl mx-auto space-y-12">
          
          {/* Header */}
          <header className="flex items-end justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-light tracking-tight">Dashboard</h1>
              <div className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-bold border border-white/10 text-white/50 mb-1">
                Dry Run
              </div>
            </div>
            <div className="text-xs text-white/40 tabular-nums">
              Last updated: Just now
            </div>
          </header>

          {/* Stats Row */}
          <section className="grid grid-cols-3 gap-6">
            <div className="p-6 rounded-[8px] flex flex-col gap-4" style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold">Account Value</div>
              <div className="text-3xl tabular-nums font-medium">£1,269.00</div>
            </div>
            
            <div className="p-6 rounded-[8px] flex flex-col gap-4" style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold">Invested</div>
              <div className="text-3xl tabular-nums font-medium">£1,431.70</div>
            </div>
            
            <div className="p-6 rounded-[8px] flex flex-col gap-4" style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold">Total P&L</div>
              <div className="text-3xl tabular-nums font-medium text-[#f87171]">−£162.70</div>
            </div>
          </section>

          {/* Two Column Layout */}
          <section className="grid grid-cols-2 gap-8">
            
            {/* Live Positions */}
            <div className="space-y-6">
              <h2 className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold pl-1">Live Positions</h2>
              <div className="space-y-4">
                {/* Position Item */}
                <div className="p-5 rounded-[8px] flex items-center justify-between" style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs font-bold text-white/70">
                      OIL
                    </div>
                    <div>
                      <div className="text-sm font-medium">OIL_CRUDE</div>
                      <div className="text-xs text-white/40 tabular-nums mt-0.5">200 units</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium tabular-nums text-[#10b981]" style={{ textShadow: '0 0 8px rgba(16,185,129,0.4)' }}>
                      +£207.20
                    </div>
                    <div className="text-xs text-[#10b981]/70 tabular-nums mt-0.5">
                      +1.36%
                    </div>
                  </div>
                </div>
                
                {/* Position Item */}
                <div className="p-5 rounded-[8px] flex items-center justify-between" style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs font-bold text-white/70">
                      US5
                    </div>
                    <div>
                      <div className="text-sm font-medium">US500</div>
                      <div className="text-xs text-white/40 tabular-nums mt-0.5">50 units</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium tabular-nums text-[#f87171]">
                      −£84.50
                    </div>
                    <div className="text-xs text-[#f87171]/70 tabular-nums mt-0.5">
                      −0.45%
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Signals & Market News */}
            <div className="space-y-10">
              
              {/* Recent Signals */}
              <div className="space-y-6">
                <h2 className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold pl-1">Recent Signals</h2>
                <div className="p-2 rounded-[8px] space-y-1" style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex items-center justify-between p-3 rounded hover:bg-white/[0.02] transition-colors">
                    <div className="text-sm font-medium">US500</div>
                    <div className="px-2.5 py-1 rounded text-[10px] font-bold tracking-wider text-[#d97706] bg-[#d97706]/10 border border-[#d97706]/20">
                      HOLD
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded hover:bg-white/[0.02] transition-colors">
                    <div className="text-sm font-medium">OIL_CRUDE</div>
                    <div className="px-2.5 py-1 rounded text-[10px] font-bold tracking-wider text-[#d97706] bg-[#d97706]/10 border border-[#d97706]/20">
                      HOLD
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded hover:bg-white/[0.02] transition-colors">
                    <div className="text-sm font-medium">PL</div>
                    <div className="px-2.5 py-1 rounded text-[10px] font-bold tracking-wider text-[#d97706] bg-[#d97706]/10 border border-[#d97706]/20">
                      HOLD
                    </div>
                  </div>
                </div>
              </div>

              {/* Market News */}
              <div className="space-y-6">
                <h2 className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold pl-1">Market News</h2>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#f87171] shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-white/90 leading-snug">
                        Federal Reserve signals potential rate cut in upcoming quarter
                      </div>
                      <div className="text-xs text-white/40 mt-1.5 flex items-center gap-2">
                        <span>Bloomberg</span>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span>2h ago</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#fbbf24] shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-white/90 leading-snug">
                        OPEC+ maintains production targets despite output drop
                      </div>
                      <div className="text-xs text-white/40 mt-1.5 flex items-center gap-2">
                        <span>Reuters</span>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span>4h ago</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#fbbf24] shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-white/90 leading-snug">
                        Tech stocks rally as earnings season kicks off
                      </div>
                      <div className="text-xs text-white/40 mt-1.5 flex items-center gap-2">
                        <span>Financial Times</span>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span>5h ago</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </section>

        </div>
      </main>
    </div>
  );
}

export default ObsidianNoir;
