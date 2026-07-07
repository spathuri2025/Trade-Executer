import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBotStatus,
  getGetBotStatusQueryKey,
  useGetScannerStatus,
  getGetScannerStatusQueryKey,
  useUpdateBotConfig,
  useUpdateScannerConfig,
  useStartBot,
  useListInstruments,
  getListInstrumentsQueryKey,
  useAddInstrument,
  useDeleteInstrument,
  useGetBrokerStatus,
  getGetBrokerStatusQueryKey,
  useConnectBroker,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useOnboarding } from "@/hooks/use-onboarding";
import { Check, ChevronRight, Trash2, Plus, Link2 } from "lucide-react";

type AiTradeMode = "off" | "guard" | "autonomous";
type PresetName = "conservative" | "balanced" | "aggressive";
type BrokerName = "trading212" | "capitalcom";

const BROKER_LABELS: Record<BrokerName, string> = {
  trading212: "Trading 212",
  capitalcom: "Capital.com",
};

type PresetValues = {
  maxPositionSizePercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  minTrendStrength: number;
  riskPerTradePercent: number;
  maxDailyLossPercent: number;
  maxConcurrentPositions: number;
};

const PRESETS: Record<PresetName, { title: string; blurb: string; values: PresetValues }> = {
  conservative: {
    title: "Conservative",
    blurb: "Small positions, tight stops. Protects capital first — fewer, safer trades.",
    values: {
      maxPositionSizePercent: 3,
      stopLossPercent: 1.5,
      takeProfitPercent: 3,
      minTrendStrength: 1.0,
      riskPerTradePercent: 0.5,
      maxDailyLossPercent: 2,
      maxConcurrentPositions: 3,
    },
  },
  balanced: {
    title: "Balanced",
    blurb: "A middle ground between safety and opportunity. A sensible default.",
    values: {
      maxPositionSizePercent: 5,
      stopLossPercent: 2,
      takeProfitPercent: 4,
      minTrendStrength: 0.5,
      riskPerTradePercent: 1,
      maxDailyLossPercent: 3,
      maxConcurrentPositions: 5,
    },
  },
  aggressive: {
    title: "Aggressive",
    blurb: "Larger positions, wider stops, more trades. Higher potential — higher risk.",
    values: {
      maxPositionSizePercent: 10,
      stopLossPercent: 3,
      takeProfitPercent: 6,
      minTrendStrength: 0.25,
      riskPerTradePercent: 2,
      maxDailyLossPercent: 5,
      maxConcurrentPositions: 8,
    },
  },
};

const AI_MODES: { value: AiTradeMode; title: string; desc: string }[] = [
  {
    value: "off",
    title: "Strategy only",
    desc: "The moving-average strategy decides trades on its own. The AI is not involved.",
  },
  {
    value: "guard",
    title: "AI safety check",
    desc: "The strategy finds a trade, then the AI double-checks it and can block it before any order is placed.",
  },
  {
    value: "autonomous",
    title: "AI decides",
    desc: "The AI itself decides what to buy or sell from your live data, then places the order.",
  },
];

const muted = "hsl(var(--muted-foreground))";
const cardBorder = "1px solid hsl(var(--card-border))";
const card = "hsl(var(--card))";

const STEPS = ["Connect Broker", "Instruments", "Risk preset", "AI mode", "Review"];

function StepHeader({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                border: active ? "1px solid hsl(var(--primary))" : cardBorder,
                color: active ? "hsl(var(--primary))" : done ? "hsl(var(--foreground))" : muted,
                backgroundColor: active ? "hsl(var(--primary) / 0.1)" : "transparent",
              }}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                style={{
                  backgroundColor: done ? "hsl(var(--primary))" : "hsl(var(--accent))",
                  color: done ? "hsl(var(--primary-foreground))" : muted,
                }}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {label}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5" style={{ color: muted }} />}
          </div>
        );
      })}
    </div>
  );
}

export default function Setup() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setOnboarded } = useOnboarding();

  const [step, setStep] = useState(0);
  const [preset, setPreset] = useState<PresetName>("balanced");
  const [advanced, setAdvanced] = useState(false);
  const [risk, setRisk] = useState<PresetValues>(PRESETS.balanced.values);
  const [aiMode, setAiMode] = useState<AiTradeMode>("off");

  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");

  const [broker, setBroker] = useState<BrokerName>("capitalcom");
  const [capitalApiKey, setCapitalApiKey] = useState("");
  const [capitalIdentifier, setCapitalIdentifier] = useState("");
  const [capitalPassword, setCapitalPassword] = useState("");
  const [t212ApiKey, setT212ApiKey] = useState("");

  const { data: brokerStatus, isLoading: brokerStatusLoading } = useGetBrokerStatus({
    query: { queryKey: getGetBrokerStatusQueryKey() },
  });
  const connectBroker = useConnectBroker({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBrokerStatusQueryKey() }),
      onError: (err: unknown) =>
        toast({
          title: "Failed to connect broker",
          description: err instanceof Error ? err.message : "Check your credentials and try again.",
          variant: "destructive",
        }),
    },
  });
  const handleConnectBroker = (e: React.FormEvent) => {
    e.preventDefault();
    if (broker === "capitalcom") {
      connectBroker.mutate({
        data: { broker: "capitalcom", capital: { apiKey: capitalApiKey, identifier: capitalIdentifier, password: capitalPassword } },
      });
    } else {
      connectBroker.mutate({ data: { broker: "trading212", trading212: { apiKey: t212ApiKey } } });
    }
  };

  const { data: botStatus, isLoading: botLoading } = useGetBotStatus({
    query: { queryKey: getGetBotStatusQueryKey() },
  });
  const { data: scannerStatus } = useGetScannerStatus({
    query: { queryKey: getGetScannerStatusQueryKey() },
  });
  const { data: instruments, isLoading: instLoading } = useListInstruments({
    query: { queryKey: getListInstrumentsQueryKey() },
  });

  const invalidateInstruments = () =>
    queryClient.invalidateQueries({ queryKey: getListInstrumentsQueryKey() });

  const addInstrument = useAddInstrument({
    mutation: {
      onSuccess: () => {
        setTicker("");
        setName("");
        invalidateInstruments();
      },
      onError: (err: unknown) =>
        toast({
          title: "Failed to add instrument",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        }),
    },
  });
  const deleteInstrument = useDeleteInstrument({
    mutation: { onSuccess: invalidateInstruments },
  });

  const updateBotConfig = useUpdateBotConfig();
  const updateScannerConfig = useUpdateScannerConfig();
  const startBot = useStartBot();

  // Applying a preset overwrites the editable risk values.
  const applyPreset = (name: PresetName) => {
    setPreset(name);
    setRisk(PRESETS[name].values);
  };

  const handleAddInstrument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !name) return;
    addInstrument.mutate({ data: { ticker: ticker.toUpperCase(), name, enabled: true } });
  };

  const enabledCount = (instruments ?? []).filter((i) => i.enabled).length;
  const canProceedInstruments = (instruments ?? []).length > 0;

  const [finishing, setFinishing] = useState(false);

  const handleFinish = async () => {
    if (!botStatus?.config) return;
    setFinishing(true);
    try {
      await updateBotConfig.mutateAsync({
        data: {
          ...botStatus.config,
          maxPositionSizePercent: risk.maxPositionSizePercent,
          stopLossPercent: risk.stopLossPercent,
          takeProfitPercent: risk.takeProfitPercent,
          riskPerTradePercent: risk.riskPerTradePercent,
          maxDailyLossPercent: risk.maxDailyLossPercent,
          maxConcurrentPositions: risk.maxConcurrentPositions,
          aiTradeMode: aiMode,
          // Safety: setup ALWAYS starts the engine in Dry Run (paper only).
          // Never inherit a live dryRun=false from a prior config here.
          dryRun: true,
        },
      });
      if (scannerStatus?.config) {
        await updateScannerConfig.mutateAsync({
          data: { ...scannerStatus.config, minTrendStrength: risk.minTrendStrength },
        });
      }
      await startBot.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
      setOnboarded(true);
      toast({ title: "Setup complete — engine started (Dry Run stays on until you turn it off)." });
      navigate("/");
    } catch (err) {
      toast({
        title: "Setup failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setFinishing(false);
    }
  };

  const skip = () => {
    setOnboarded(true);
    navigate("/");
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-4xl font-light tracking-tight">Guided Setup</h1>
          <p className="text-sm mt-2 max-w-2xl" style={{ color: muted }}>
            A fast path to get your bot running. You can always fine-tune everything later on the
            Instruments, Scanner, and Settings pages — this doesn't lock anything.
          </p>
        </div>
        <button type="button" onClick={skip} className="text-xs underline" style={{ color: muted }} data-testid="button-skip-setup">
          Skip setup
        </button>
      </div>

      <StepHeader step={step} />

      <div className="p-6 rounded-lg" style={{ backgroundColor: card, border: cardBorder }}>
        {/* ── Step 1: connect broker ── */}
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-medium">Connect your broker</h2>
              <p className="text-sm mt-1" style={{ color: muted }}>
                Bring your own {BROKER_LABELS[broker]} account. Your credentials are encrypted and used only for
                your own bot.
              </p>
            </div>

            {brokerStatusLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : brokerStatus?.connected ? (
              <div className="flex items-center gap-2 p-4 rounded-lg text-sm" style={{ border: cardBorder }}>
                <Link2 className="h-4 w-4 text-primary" />
                <span>
                  Connected to <span className="font-medium">{BROKER_LABELS[brokerStatus.broker ?? broker]}</span>
                  {brokerStatus.identifierMasked && <span style={{ color: muted }}> ({brokerStatus.identifierMasked})</span>}
                </span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(["capitalcom", "trading212"] as BrokerName[]).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBroker(b)}
                      className="rounded-lg border px-4 py-3 text-sm font-medium text-left transition-all"
                      style={{
                        borderColor: broker === b ? "hsl(var(--primary))" : "hsl(var(--border))",
                        backgroundColor: broker === b ? "hsl(var(--primary) / 0.1)" : "hsl(var(--accent) / 0.3)",
                        color: broker === b ? "hsl(var(--primary))" : undefined,
                      }}
                      data-testid={`button-setup-broker-${b}`}
                    >
                      {BROKER_LABELS[b]}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleConnectBroker} className="space-y-3">
                  {broker === "capitalcom" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="setup-capital-api-key">API Key</Label>
                        <Input id="setup-capital-api-key" value={capitalApiKey} onChange={(e) => setCapitalApiKey(e.target.value)} required data-testid="input-setup-capital-api-key" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="setup-capital-identifier">Identifier (email)</Label>
                        <Input id="setup-capital-identifier" value={capitalIdentifier} onChange={(e) => setCapitalIdentifier(e.target.value)} required data-testid="input-setup-capital-identifier" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="setup-capital-password">Password</Label>
                        <Input id="setup-capital-password" type="password" value={capitalPassword} onChange={(e) => setCapitalPassword(e.target.value)} required data-testid="input-setup-capital-password" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor="setup-t212-api-key">API Key</Label>
                      <Input id="setup-t212-api-key" value={t212ApiKey} onChange={(e) => setT212ApiKey(e.target.value)} required data-testid="input-setup-t212-api-key" />
                    </div>
                  )}
                  <Button type="submit" disabled={connectBroker.isPending} data-testid="button-setup-connect-broker">
                    {connectBroker.isPending ? "Connecting…" : "Connect"}
                  </Button>
                </form>
              </>
            )}
          </div>
        )}

        {/* ── Step 2: instruments ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-medium">Pick instruments to track</h2>
              <p className="text-sm mt-1" style={{ color: muted }}>
                Add the tickers you want the bot to watch. Same list as the Instruments page.
              </p>
            </div>
            <form onSubmit={handleAddInstrument} className="flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="Ticker (e.g. AAPL)"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                className="font-mono uppercase"
                data-testid="input-setup-ticker"
              />
              <Input
                placeholder="Name (e.g. Apple Inc.)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-setup-name"
              />
              <Button type="submit" disabled={addInstrument.isPending || !ticker || !name} data-testid="button-setup-add">
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </form>

            <div className="rounded-lg overflow-hidden" style={{ border: cardBorder }}>
              {instLoading ? (
                <div className="p-4 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              ) : (instruments ?? []).length === 0 ? (
                <div className="p-6 text-sm text-center" style={{ color: muted }}>
                  No instruments yet — add at least one to continue.
                </div>
              ) : (
                (instruments ?? []).map((inst, idx) => (
                  <div
                    key={inst.id}
                    className="flex items-center justify-between p-4"
                    style={idx < (instruments ?? []).length - 1 ? { borderBottom: "1px solid hsl(var(--border))" } : {}}
                  >
                    <div>
                      <div className="font-mono font-medium text-sm">{inst.ticker}</div>
                      <div className="text-xs" style={{ color: muted }}>{inst.name}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => deleteInstrument.mutate({ id: inst.id })}
                      disabled={deleteInstrument.isPending}
                      data-testid={`button-setup-remove-${inst.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: risk preset ── */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-medium">Choose a risk preset</h2>
              <p className="text-sm mt-1" style={{ color: muted }}>
                Each preset sets your position size, stop-loss, take-profit, and how strong a trend
                must be before trading — all at once.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(PRESETS) as PresetName[]).map((name) => {
                const p = PRESETS[name];
                const active = preset === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => applyPreset(name)}
                    className="rounded-lg border p-4 text-left transition-all"
                    style={{
                      borderColor: active ? "hsl(var(--primary))" : "hsl(var(--border))",
                      backgroundColor: active ? "hsl(var(--primary) / 0.1)" : "hsl(var(--accent) / 0.3)",
                    }}
                    data-testid={`button-preset-${name}`}
                  >
                    <div className="text-sm font-semibold" style={active ? { color: "hsl(var(--primary))" } : {}}>
                      {p.title}
                    </div>
                    <div className="text-xs mt-1 leading-relaxed" style={{ color: muted }}>{p.blurb}</div>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setAdvanced((a) => !a)}
              className="text-xs underline"
              style={{ color: muted }}
              data-testid="button-toggle-advanced"
            >
              {advanced ? "Hide advanced values" : "Advanced — edit raw values"}
            </button>

            {advanced && (
              <div className="grid gap-4 sm:grid-cols-2 rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))" }}>
                {([
                  ["maxPositionSizePercent", "Max Position Size (%)"],
                  ["stopLossPercent", "Stop-Loss (%)"],
                  ["takeProfitPercent", "Take-Profit (%)"],
                  ["minTrendStrength", "Min Trend Strength (%)"],
                  ["riskPerTradePercent", "Risk Per Trade (%)"],
                  ["maxDailyLossPercent", "Max Daily Loss (%)"],
                  ["maxConcurrentPositions", "Max Concurrent Positions"],
                ] as [keyof PresetValues, string][]).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <label className="text-xs font-medium">{label}</label>
                    <Input
                      type="number"
                      value={risk[key]}
                      onChange={(e) => setRisk({ ...risk, [key]: Number(e.target.value) })}
                      className="font-mono"
                      step={key === "maxConcurrentPositions" ? 1 : 0.1}
                      min={0}
                      data-testid={`input-advanced-${key}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: AI mode ── */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-medium">How should the AI take part?</h2>
              <p className="text-sm mt-1" style={{ color: muted }}>
                The AI can never override your risk limits above — they always apply.
              </p>
            </div>
            <div className="space-y-3">
              {AI_MODES.map((mode) => {
                const active = aiMode === mode.value;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setAiMode(mode.value)}
                    className="w-full rounded-lg border px-4 py-3 text-left transition-all"
                    style={{
                      borderColor: active ? "hsl(var(--primary))" : "hsl(var(--border))",
                      backgroundColor: active ? "hsl(var(--primary) / 0.1)" : "hsl(var(--accent) / 0.3)",
                    }}
                    data-testid={`button-setup-ai-${mode.value}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3.5 w-3.5 rounded-full border shrink-0"
                        style={{
                          borderColor: active ? "hsl(var(--primary))" : muted,
                          backgroundColor: active ? "hsl(var(--primary))" : "transparent",
                        }}
                      />
                      <span className="text-sm font-semibold" style={active ? { color: "hsl(var(--primary))" } : {}}>
                        {mode.title}
                      </span>
                    </div>
                    <div className="text-xs mt-1 pl-6" style={{ color: muted }}>{mode.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Step 5: review ── */}
        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-medium">Review &amp; start</h2>
              <p className="text-sm mt-1" style={{ color: muted }}>
                The engine starts in <span className="font-medium" style={{ color: "hsl(var(--foreground))" }}>Dry Run</span> —
                trades are simulated only until you turn Dry Run off in Settings.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="text-xs uppercase tracking-wider" style={{ color: muted }}>Instruments</div>
                <div>{(instruments ?? []).length} tracked · {enabledCount} enabled</div>
              </div>
              <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="text-xs uppercase tracking-wider" style={{ color: muted }}>Risk preset</div>
                <div>{PRESETS[preset].title}{advanced ? " (customised)" : ""}</div>
                <div className="text-xs" style={{ color: muted }}>
                  Max size {risk.maxPositionSizePercent}% · SL {risk.stopLossPercent}% · TP {risk.takeProfitPercent}% · min trend {risk.minTrendStrength}%
                </div>
              </div>
              <div className="rounded-lg border p-4 space-y-2 sm:col-span-2" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="text-xs uppercase tracking-wider" style={{ color: muted }}>AI trade mode</div>
                <div>{AI_MODES.find((m) => m.value === aiMode)?.title}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Nav buttons ── */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          data-testid="button-setup-back"
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            onClick={() => setStep((s) => s + 1)}
            disabled={
              (step === 0 && !brokerStatus?.connected) ||
              (step === 1 && (botLoading || !canProceedInstruments))
            }
            data-testid="button-setup-next"
          >
            Next
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={finishing || botLoading} data-testid="button-setup-finish">
            {finishing ? "Starting…" : "Start Engine"}
          </Button>
        )}
      </div>
    </div>
  );
}
