import React from "react";
import {
  TrendingUp,
  LayoutDashboard,
  BarChart2,
  Settings,
  Activity,
  FileText,
  TrendingDown,
  DollarSign,
  ArrowDown,
  Flame,
  AlertCircle,
  Clock,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react";

export function MidnightFinance() {
  return (
    <div
      className="min-h-screen text-slate-200 font-['Space_Grotesk'] flex"
      style={{ backgroundColor: "#0e0f1f" }}
    >
      {/* Aurora Background Effect */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: "600px",
          height: "600px",
          background: "radial-gradient(circle at top right, rgba(99,102,241,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Sidebar */}
      <aside
        className="w-60 flex-shrink-0 flex flex-col border-r border-white/5 relative z-10"
        style={{ background: "linear-gradient(to bottom, #13142a, #0e0f1f)" }}
      >
        <div className="p-6">
          <div className="flex items-center gap-2">
            <TrendingUp size={24} color="#f59e0b" />
            <span className="text-xl font-bold tracking-tight text-white">TradeBuzz</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">
            Powered by ClinAITech
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <a
            href="#"
            className="flex items-center gap-3 px-3 py-2.5 rounded text-amber-500 transition-colors"
            style={{
              backgroundColor: "rgba(251,191,36,0.1)",
              borderLeft: "3px solid #f59e0b",
            }}
          >
            <LayoutDashboard size={18} />
            <span className="font-medium text-sm">Dashboard</span>
          </a>
          <a
            href="#"
            className="flex items-center gap-3 px-3 py-2.5 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors border-l-[3px] border-transparent"
          >
            <BarChart2 size={18} />
            <span className="font-medium text-sm">Positions</span>
          </a>
          <a
            href="#"
            className="flex items-center gap-3 px-3 py-2.5 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors border-l-[3px] border-transparent"
          >
            <Activity size={18} />
            <span className="font-medium text-sm">Signals</span>
          </a>
          <a
            href="#"
            className="flex items-center gap-3 px-3 py-2.5 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors border-l-[3px] border-transparent"
          >
            <FileText size={18} />
            <span className="font-medium text-sm">News</span>
          </a>
          <a
            href="#"
            className="flex items-center gap-3 px-3 py-2.5 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors border-l-[3px] border-transparent"
          >
            <Settings size={18} />
            <span className="font-medium text-sm">Settings</span>
          </a>
        </nav>

        <div className="p-6">
          <p className="text-[10px] text-slate-500 font-medium text-center">
            © 2026 ClinAITech Limited · UK
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative z-10 p-8">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-semibold text-white tracking-tight">
              Dashboard
              <span className="block h-0.5 w-12 bg-[#f59e0b] mt-2 rounded-full" />
            </h1>
          </div>
          <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 shadow-sm">
            <div className="w-2 h-2 rounded-full bg-[#34d399] animate-pulse" />
            <span className="text-sm font-medium text-slate-300">Bot Active</span>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Account Value */}
          <div
            className="rounded-[12px] overflow-hidden"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              className="h-1.5 w-full"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.5), rgba(251,191,36,0.3))",
              }}
            />
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                  Account Value
                </h3>
                <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                  <TrendingDown size={16} color="#f87171" />
                </div>
              </div>
              <p className="text-3xl font-bold text-white font-['JetBrains_Mono']">
                £1,269.00
              </p>
            </div>
          </div>

          {/* Invested */}
          <div
            className="rounded-[12px] overflow-hidden"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              className="h-1.5 w-full"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.5), rgba(251,191,36,0.3))",
              }}
            />
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                  Invested
                </h3>
                <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <DollarSign size={16} className="text-blue-400" />
                </div>
              </div>
              <p className="text-3xl font-bold text-white font-['JetBrains_Mono']">
                £1,431.70
              </p>
            </div>
          </div>

          {/* Total P&L */}
          <div
            className="rounded-[12px] overflow-hidden"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              className="h-1.5 w-full"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.5), rgba(251,191,36,0.3))",
              }}
            />
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                  Total P&L
                </h3>
                <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                  <ArrowDown size={16} color="#f87171" />
                </div>
              </div>
              <p className="text-3xl font-bold font-['JetBrains_Mono']" style={{ color: "#f87171" }}>
                −£162.70
              </p>
            </div>
          </div>
        </div>

        {/* Two Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Positions */}
          <div
            className="rounded-[12px] overflow-hidden flex flex-col"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Active Positions</h2>
              <button className="text-sm text-[#f59e0b] hover:text-amber-400 transition-colors">
                View All
              </button>
            </div>
            <div className="p-5 flex-1">
              <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                    <Activity size={20} className="text-indigo-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-white text-base">OIL_CRUDE</h4>
                    <p className="text-xs text-slate-400 font-['JetBrains_Mono'] mt-0.5">
                      QTY: 100 • ENTRY: 75.40
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-['JetBrains_Mono'] font-bold" style={{ color: "#34d399" }}>
                    +£45.20
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 font-['JetBrains_Mono']">
                    CURRENT: 75.85
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Signals */}
          <div
            className="rounded-[12px] overflow-hidden flex flex-col"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Latest Signals</h2>
              <button className="text-sm text-[#f59e0b] hover:text-amber-400 transition-colors">
                View Scanner
              </button>
            </div>
            <div className="p-5 flex-1 space-y-3">
              {[
                { sym: "EUR_USD", signal: "HOLD", color: "#8b5cf6", ma: "SMA 50: 1.0850" },
                { sym: "US_TECH100", signal: "BUY", color: "#34d399", ma: "EMA 20: 17850" },
                { sym: "GOLD", signal: "SELL", color: "#f87171", ma: "SMA 200: 2015" },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5"
                >
                  <div>
                    <h4 className="font-semibold text-sm text-slate-200">{item.sym}</h4>
                    <p className="text-[11px] text-slate-400 font-['JetBrains_Mono'] mt-0.5">
                      {item.ma}
                    </p>
                  </div>
                  <div
                    className="px-2.5 py-1 rounded text-xs font-bold font-['JetBrains_Mono'] uppercase tracking-wider"
                    style={{
                      backgroundColor: `${item.color}20`,
                      color: item.color,
                      border: `1px solid ${item.color}40`,
                    }}
                  >
                    {item.signal}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* News */}
        <div
          className="rounded-[12px] overflow-hidden"
          style={{
            backgroundColor: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="p-5 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <FileText size={18} className="text-slate-400" />
              Market News
            </h2>
          </div>
          <div className="divide-y divide-white/5">
            {[
              {
                title: "Federal Reserve indicates potential rate cut in Q3",
                time: "10 mins ago",
                impact: "HIGH",
                icon: <Flame size={14} color="#f59e0b" />,
              },
              {
                title: "OPEC+ agrees to maintain current oil production levels",
                time: "1 hour ago",
                impact: "MEDIUM",
                icon: <AlertCircle size={14} className="text-yellow-400" />,
              },
              {
                title: "Tech sector rallies on strong AI earnings reports",
                time: "3 hours ago",
                impact: "MEDIUM",
                icon: <AlertCircle size={14} className="text-yellow-400" />,
              },
            ].map((news, i) => (
              <div key={i} className="p-5 hover:bg-white/5 transition-colors cursor-pointer flex gap-4">
                <div className="mt-0.5">{news.icon}</div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-slate-200 leading-snug">{news.title}</h4>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-slate-500 flex items-center gap-1 font-['JetBrains_Mono']">
                      <Clock size={12} />
                      {news.time}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-bold tracking-wider"
                      style={{
                        backgroundColor: news.impact === "HIGH" ? "rgba(245,158,11,0.15)" : "rgba(250,204,21,0.1)",
                        color: news.impact === "HIGH" ? "#f59e0b" : "#facc15",
                      }}
                    >
                      {news.impact} IMPACT
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
