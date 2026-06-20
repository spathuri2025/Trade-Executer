import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

/**
 * Data layer for the TradeBuzz dashboard.
 *
 * The browser only talks to the Node API server (same origin, behind the shared
 * proxy). The Node server authenticates via a session cookie and proxies to the
 * Python bot engine, injecting the admin key server-side. The admin key is never
 * exposed to the browser.
 *
 * Auth endpoints live at `/api/auth/*`. All bot-engine endpoints are proxied
 * under `/api/engine/*`.
 */

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers:
      options.body != null
        ? { "content-type": "application/json", ...(options.headers ?? {}) }
        : options.headers,
    ...options,
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : typeof parsed === "string"
          ? parsed
          : res.statusText) || "Request failed";
    throw new ApiError(res.status, message);
  }

  return parsed as T;
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type BotState = "STOPPED" | "RUNNING" | "PAUSED" | "EMERGENCY_STOP";

export interface BotStatus {
  state: BotState;
  started_at: string | null;
  mode: string;
  live_trading_enabled: boolean;
}

export interface Trade {
  id: number;
  symbol: string;
  market: string;
  direction: string;
  mode: string;
  entry_price: number | null;
  exit_price: number | null;
  quantity: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  status: string;
  is_paper: boolean;
  opened_at: string | null;
  closed_at: string | null;
}

export interface Signal {
  id: number;
  symbol: string;
  market: string;
  signal_type: string;
  confidence: number | null;
  price_at_signal: number | null;
  reasoning: string | null;
  acted_on: string | null;
  created_at: string | null;
}

export interface Strategy {
  id: number;
  name: string;
  symbol: string;
  market: string;
  timeframe: string;
  stop_loss_pct: number;
  take_profit_pct: number;
  max_trades_per_day: number;
  confidence_threshold: number;
  is_active: boolean;
  parameters: Record<string, unknown>;
}

export interface StrategyInput {
  name: string;
  symbol: string;
  market?: string;
  timeframe?: string;
  stop_loss_pct?: number;
  take_profit_pct?: number;
  max_trades_per_day?: number;
  confidence_threshold?: number;
  parameters?: Record<string, unknown>;
}

export interface StrategyUpdate {
  name?: string;
  symbol?: string;
  market?: string;
  timeframe?: string;
  stop_loss_pct?: number;
  take_profit_pct?: number;
  max_trades_per_day?: number;
  confidence_threshold?: number;
  is_active?: boolean;
  parameters?: Record<string, unknown>;
}

export interface RiskLimits {
  max_daily_loss_pct: number | null;
  max_weekly_loss_pct: number | null;
  max_drawdown_pct: number | null;
  max_position_size_pct: number | null;
  max_trades_per_day: number | null;
  require_stop_loss: boolean | null;
}

export interface RiskStatus {
  emergency_stop_active: boolean;
  emergency_stop_reason: string | null;
  risk_limits: RiskLimits | null;
}

export interface RiskLimitUpdate {
  max_daily_loss_pct?: number;
  max_weekly_loss_pct?: number;
  max_drawdown_pct?: number;
  max_position_size_pct?: number;
  max_trades_per_day?: number;
  require_stop_loss?: boolean;
  allowed_markets?: string;
}

export interface BotLog {
  id: number;
  level: string;
  event: string;
  message: string | null;
  symbol: string | null;
  strategy: string | null;
  extra: Record<string, unknown> | null;
  created_at: string | null;
}

export interface MessageResponse {
  message: string;
}

export interface AuthState {
  authenticated: boolean;
}

// ----------------------------------------------------------------------------
// Query keys
// ----------------------------------------------------------------------------

export const queryKeys = {
  auth: ["auth", "me"] as const,
  health: ["engine", "health"] as const,
  botStatus: ["engine", "bot", "status"] as const,
  riskStatus: ["engine", "risk", "status"] as const,
  strategies: ["engine", "strategies"] as const,
  trades: (params?: TradesParams) =>
    ["engine", "trades", params ?? {}] as const,
  signals: (params?: SignalsParams) =>
    ["engine", "signals", params ?? {}] as const,
  logs: (params?: LogsParams) => ["engine", "logs", params ?? {}] as const,
};

export interface TradesParams {
  limit?: number;
  offset?: number;
  status?: string;
  symbol?: string;
}

export interface SignalsParams {
  limit?: number;
  offset?: number;
  symbol?: string;
}

export interface LogsParams {
  limit?: number;
  offset?: number;
  level?: string;
  event?: string;
}

function toQueryString(params?: Record<string, unknown> | object): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}

// ----------------------------------------------------------------------------
// Auth hooks
// ----------------------------------------------------------------------------

export function useAuthStatus(
  options?: Partial<UseQueryOptions<AuthState, ApiError>>,
) {
  return useQuery<AuthState, ApiError>({
    queryKey: queryKeys.auth,
    queryFn: () => request<AuthState>("/auth/me"),
    ...options,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, ApiError, { password: string }>({
    mutationFn: (body) =>
      request<{ ok: boolean }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.auth });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, ApiError, void>({
    mutationFn: () =>
      request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
      qc.invalidateQueries({ queryKey: queryKeys.auth });
    },
  });
}

// ----------------------------------------------------------------------------
// Read hooks
// ----------------------------------------------------------------------------

export function useHealth(
  options?: Partial<UseQueryOptions<{ status: string }, ApiError>>,
) {
  return useQuery<{ status: string }, ApiError>({
    queryKey: queryKeys.health,
    queryFn: () => request<{ status: string }>("/engine/health"),
    ...options,
  });
}

export function useBotStatus(
  options?: Partial<UseQueryOptions<BotStatus, ApiError>>,
) {
  return useQuery<BotStatus, ApiError>({
    queryKey: queryKeys.botStatus,
    queryFn: () => request<BotStatus>("/engine/bot/status"),
    refetchInterval: 5000,
    ...options,
  });
}

export function useTrades(
  params?: TradesParams,
  options?: Partial<UseQueryOptions<Trade[], ApiError>>,
) {
  return useQuery<Trade[], ApiError>({
    queryKey: queryKeys.trades(params),
    queryFn: () => request<Trade[]>(`/engine/trades${toQueryString(params)}`),
    refetchInterval: 10000,
    ...options,
  });
}

export function useSignals(
  params?: SignalsParams,
  options?: Partial<UseQueryOptions<Signal[], ApiError>>,
) {
  return useQuery<Signal[], ApiError>({
    queryKey: queryKeys.signals(params),
    queryFn: () => request<Signal[]>(`/engine/signals${toQueryString(params)}`),
    refetchInterval: 10000,
    ...options,
  });
}

export function useStrategies(
  options?: Partial<UseQueryOptions<Strategy[], ApiError>>,
) {
  return useQuery<Strategy[], ApiError>({
    queryKey: queryKeys.strategies,
    queryFn: () => request<Strategy[]>("/engine/strategies"),
    ...options,
  });
}

export function useRiskStatus(
  options?: Partial<UseQueryOptions<RiskStatus, ApiError>>,
) {
  return useQuery<RiskStatus, ApiError>({
    queryKey: queryKeys.riskStatus,
    queryFn: () => request<RiskStatus>("/engine/risk/status"),
    refetchInterval: 10000,
    ...options,
  });
}

export function useLogs(
  params?: LogsParams,
  options?: Partial<UseQueryOptions<BotLog[], ApiError>>,
) {
  return useQuery<BotLog[], ApiError>({
    queryKey: queryKeys.logs(params),
    queryFn: () => request<BotLog[]>(`/engine/logs${toQueryString(params)}`),
    refetchInterval: 8000,
    ...options,
  });
}

// ----------------------------------------------------------------------------
// Bot control mutations
// ----------------------------------------------------------------------------

function useBotControls() {
  return useQueryClient();
}

function invalidateBot(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: queryKeys.botStatus });
  qc.invalidateQueries({ queryKey: queryKeys.riskStatus });
}

export function useStartBot() {
  const qc = useBotControls();
  return useMutation<MessageResponse, ApiError, void>({
    mutationFn: () =>
      request<MessageResponse>("/engine/bot/start", { method: "POST" }),
    onSuccess: () => invalidateBot(qc),
  });
}

export function useStopBot() {
  const qc = useBotControls();
  return useMutation<MessageResponse, ApiError, void>({
    mutationFn: () =>
      request<MessageResponse>("/engine/bot/stop", { method: "POST" }),
    onSuccess: () => invalidateBot(qc),
  });
}

export function usePauseBot() {
  const qc = useBotControls();
  return useMutation<MessageResponse, ApiError, void>({
    mutationFn: () =>
      request<MessageResponse>("/engine/bot/pause", { method: "POST" }),
    onSuccess: () => invalidateBot(qc),
  });
}

export function useResumeBot() {
  const qc = useBotControls();
  return useMutation<MessageResponse, ApiError, void>({
    mutationFn: () =>
      request<MessageResponse>("/engine/bot/resume", { method: "POST" }),
    onSuccess: () => invalidateBot(qc),
  });
}

export function useEmergencyStop() {
  const qc = useBotControls();
  return useMutation<MessageResponse, ApiError, { reason?: string } | void>({
    mutationFn: (vars) =>
      request<MessageResponse>(
        `/engine/bot/emergency-stop${toQueryString(
          vars && "reason" in vars ? { reason: vars.reason } : undefined,
        )}`,
        { method: "POST" },
      ),
    onSuccess: () => invalidateBot(qc),
  });
}

export function useClearEmergencyStop() {
  const qc = useBotControls();
  return useMutation<MessageResponse, ApiError, void>({
    mutationFn: () =>
      request<MessageResponse>("/engine/bot/clear-emergency-stop", {
        method: "POST",
      }),
    onSuccess: () => invalidateBot(qc),
  });
}

export interface RunCycleResult {
  status: string;
  trades_attempted: number;
  signals?: string[];
}

export function useRunCycle() {
  const qc = useQueryClient();
  return useMutation<RunCycleResult, ApiError, void>({
    mutationFn: () =>
      request<RunCycleResult>("/engine/bot/run-cycle", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine", "trades"] });
      qc.invalidateQueries({ queryKey: ["engine", "signals"] });
      qc.invalidateQueries({ queryKey: ["engine", "logs"] });
      qc.invalidateQueries({ queryKey: queryKeys.botStatus });
    },
  });
}

// ----------------------------------------------------------------------------
// Strategy mutations
// ----------------------------------------------------------------------------

export function useCreateStrategy() {
  const qc = useQueryClient();
  return useMutation<{ id: number; message: string }, ApiError, StrategyInput>({
    mutationFn: (data) =>
      request<{ id: number; message: string }>("/engine/strategies", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.strategies }),
  });
}

export function useUpdateStrategy() {
  const qc = useQueryClient();
  return useMutation<
    MessageResponse,
    ApiError,
    { id: number; data: StrategyUpdate }
  >({
    mutationFn: ({ id, data }) =>
      request<MessageResponse>(`/engine/strategies/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.strategies }),
  });
}

export function useDeleteStrategy() {
  const qc = useQueryClient();
  return useMutation<MessageResponse, ApiError, { id: number }>({
    mutationFn: ({ id }) =>
      request<MessageResponse>(`/engine/strategies/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.strategies }),
  });
}

// ----------------------------------------------------------------------------
// Risk mutations
// ----------------------------------------------------------------------------

export function useUpdateRiskLimits() {
  const qc = useQueryClient();
  return useMutation<MessageResponse, ApiError, RiskLimitUpdate>({
    mutationFn: (data) =>
      request<MessageResponse>("/engine/risk/limits", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.riskStatus }),
  });
}
