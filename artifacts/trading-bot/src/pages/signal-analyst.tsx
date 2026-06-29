import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSignalConversations,
  getListSignalConversationsQueryKey,
  useCreateSignalConversation,
  useGetSignalConversation,
  getGetSignalConversationQueryKey,
  useDeleteSignalConversation,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Send,
  Trash2,
  Radar,
  User,
  MessageSquare,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldAlert,
  Globe,
  Target,
  Scale,
  Bell,
} from "lucide-react";

const cardBg = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const muted = "hsl(var(--muted-foreground))";

interface ChatMessage {
  id: number | string;
  role: "user" | "assistant";
  content: string;
}

interface Analysis {
  summary?: string;
  bias?: string;
  confidence?: string;
  reasons_for?: unknown;
  reasons_against?: unknown;
  key_risk?: string;
  macro_factor?: string;
  suggested_action?: string;
  position_size_note?: string;
  follow_up_triggers?: unknown;
}

const ANALYSIS_KEYS = [
  "summary",
  "bias",
  "confidence",
  "reasons_for",
  "reasons_against",
  "key_risk",
  "macro_factor",
  "suggested_action",
  "position_size_note",
  "follow_up_triggers",
];

/** Attempts to parse a structured analysis object out of a model reply. */
function parseAnalysis(content: string): Analysis | null {
  const trimmed = content.trim();
  let raw = trimmed;
  if (!raw.startsWith("{")) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    raw = raw.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const hasKey = ANALYSIS_KEYS.some((k) => k in parsed);
      if (hasKey) return parsed as Analysis;
    }
  } catch {
    // not structured JSON — render as plain text
  }
  return null;
}

/** Detects whether a streaming reply is (becoming) a structured JSON payload,
 *  so we can show an "Analysing…" indicator instead of raw partial JSON. */
function looksStructured(content: string): boolean {
  const t = content.trimStart();
  return t.startsWith("{") || t.startsWith("```");
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.15em",
        fontWeight: 600,
        color: muted,
      }}
    >
      {children}
    </p>
  );
}

export default function SignalAnalyst() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: conversations, isLoading: convosLoading } = useListSignalConversations({
    query: { queryKey: getListSignalConversationsQueryKey() },
  });

  const { data: conversation, isLoading: msgsLoading } = useGetSignalConversation(activeId ?? 0, {
    query: {
      queryKey: getGetSignalConversationQueryKey(activeId ?? 0),
      enabled: activeId != null,
    },
  });

  const createConversation = useCreateSignalConversation();
  const deleteConversation = useDeleteSignalConversation();

  const messages: ChatMessage[] = conversation?.messages ?? [];

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streaming, pendingUser, scrollToBottom]);

  async function ensureConversation(firstMessage: string): Promise<number> {
    if (activeId != null) return activeId;
    const title = firstMessage.length > 40 ? `${firstMessage.slice(0, 40)}…` : firstMessage;
    const created = await createConversation.mutateAsync({ data: { title } });
    await queryClient.invalidateQueries({ queryKey: getListSignalConversationsQueryKey() });
    setActiveId(created.id);
    return created.id;
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || isSending) return;

    setError(null);
    setInput("");
    setIsSending(true);
    setPendingUser(content);
    setStreaming("");

    try {
      const conversationId = await ensureConversation(content);

      const res = await fetch(`/api/signal-analyst/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.content) {
              acc += parsed.content;
              setStreaming(acc);
            } else if (parsed.error) {
              setError(parsed.error);
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }

      await queryClient.invalidateQueries({
        queryKey: getGetSignalConversationQueryKey(conversationId),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsSending(false);
      setPendingUser(null);
      setStreaming("");
    }
  }

  async function handleDelete(id: number) {
    await deleteConversation.mutateAsync({ id });
    await queryClient.invalidateQueries({ queryKey: getListSignalConversationsQueryKey() });
    if (activeId === id) setActiveId(null);
  }

  function startNewChat() {
    setActiveId(null);
    setInput("");
    setError(null);
    setStreaming("");
    setPendingUser(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const showEmpty = activeId == null && !pendingUser && messages.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <SectionLabel>Signal Analyst</SectionLabel>
          <h1 className="text-2xl font-semibold tracking-tight text-white mt-1">Signal Analyst</h1>
          <p className="text-sm mt-1" style={{ color: muted }}>
            Structured, disciplined trade analysis — signal evaluation, risk review, and macro context, grounded in your live data.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Conversation list */}
        <div className="space-y-2">
          <Button
            onClick={startNewChat}
            variant="outline"
            className="w-full justify-start gap-2 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Plus className="h-4 w-4" />
            New analysis
          </Button>

          <div className="space-y-1">
            {convosLoading ? (
              <>
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </>
            ) : conversations && conversations.length > 0 ? (
              conversations.map((c) => {
                const active = c.id === activeId;
                return (
                  <div
                    key={c.id}
                    className={`group flex items-center gap-2 rounded px-3 py-2 text-sm cursor-pointer transition-colors ${
                      active ? "bg-primary/10 text-white" : "text-white/60 hover:text-white/90 hover:bg-white/5"
                    }`}
                    onClick={() => setActiveId(c.id)}
                  >
                    <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${active ? "text-primary" : "text-white/40"}`} />
                    <span className="truncate flex-1">{c.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(c.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-destructive transition"
                      aria-label="Delete conversation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="text-xs px-3 py-2" style={{ color: muted }}>
                No analyses yet.
              </p>
            )}
          </div>
        </div>

        {/* Chat area */}
        <div
          className="flex flex-col rounded-lg overflow-hidden"
          style={{ background: cardBg, border: cardBorder, height: "calc(100vh - 280px)", minHeight: 420 }}
        >
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
            {showEmpty ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Radar className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-white font-medium">Ask the Signal Analyst</h3>
                <p className="text-sm mt-2 max-w-md" style={{ color: muted }}>
                  Paste a setup, name a ticker, or ask "should I take this trade?". You'll get a structured read:
                  bias, confidence, reasons for and against, key risk, macro factor, and a suggested action — grounded in
                  your account, positions, and signals.
                </p>
              </div>
            ) : (
              <>
                {msgsLoading && activeId != null ? (
                  <>
                    <Skeleton className="h-16 w-3/4" />
                    <Skeleton className="h-24 w-full" />
                  </>
                ) : (
                  messages.map((m) => <MessageBubble key={m.id} role={m.role} content={m.content} />)
                )}
                {pendingUser && <MessageBubble role="user" content={pendingUser} />}
                {(streaming || (isSending && !streaming)) && (
                  <MessageBubble
                    role="assistant"
                    content={streaming}
                    pending={!streaming || looksStructured(streaming)}
                  />
                )}
              </>
            )}
          </div>

          {error && (
            <div className="px-4 py-2 text-xs text-destructive border-t" style={{ borderColor: "hsl(var(--border))" }}>
              {error}
            </div>
          )}

          {/* Composer */}
          <div className="border-t p-3" style={{ borderColor: "hsl(var(--border))" }}>
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Describe a setup or ask the analyst…"
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm text-white placeholder:text-white/30 outline-none px-2 py-2 max-h-32"
                style={{ minHeight: 40 }}
              />
              <Button onClick={handleSend} disabled={!input.trim() || isSending} size="icon" className="shrink-0">
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-center" style={{ color: muted }}>
        This is analytical assistance only, not regulated financial advice. Trading involves substantial risk.
      </p>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  pending,
}: {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}) {
  const isUser = role === "user";
  const analysis = !isUser && !pending ? parseAnalysis(content) : null;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? "bg-white/10" : "bg-primary/15"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5 text-white/70" /> : <Radar className="h-3.5 w-3.5 text-primary" />}
      </div>
      <div
        className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser ? "bg-white/10 text-white max-w-[85%]" : "text-white/90"
        } ${analysis ? "w-full max-w-[95%]" : "max-w-[85%]"}`}
        style={isUser ? undefined : { background: "hsl(var(--muted) / 0.4)" }}
      >
        {pending ? (
          <span className="inline-flex items-center gap-1 text-white/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Analysing…
          </span>
        ) : analysis ? (
          <AnalysisCard analysis={analysis} />
        ) : (
          content
        )}
      </div>
    </div>
  );
}

function BiasBadge({ bias }: { bias: string }) {
  const lower = bias.toLowerCase();
  const bullish = lower.includes("bull") || lower.includes("long") || lower.includes("up");
  const bearish = lower.includes("bear") || lower.includes("short") || lower.includes("down");
  const Icon = bullish ? TrendingUp : bearish ? TrendingDown : Minus;
  const color = bullish ? "text-emerald-400" : bearish ? "text-rose-400" : "text-white/60";
  const bg = bullish ? "bg-emerald-400/10" : bearish ? "bg-rose-400/10" : "bg-white/5";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${bg} ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {bias}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const lower = confidence.toLowerCase();
  const color = lower.includes("high")
    ? "text-emerald-400 bg-emerald-400/10"
    : lower.includes("low")
      ? "text-rose-400 bg-rose-400/10"
      : "text-amber-300 bg-amber-300/10";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${color}`}>
      Confidence: {confidence}
    </span>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
}) {
  if (!value || !value.trim()) return null;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold" style={{ color: muted }}>
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="text-sm text-white/85 mt-1">{value}</p>
    </div>
  );
}

function ReasonList({
  title,
  items,
  positive,
}: {
  title: string;
  items: string[];
  positive: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wider font-semibold ${positive ? "text-emerald-400" : "text-rose-400"}`}>
        {title}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm text-white/85">
            <span className={positive ? "text-emerald-400" : "text-rose-400"}>{positive ? "+" : "−"}</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: Analysis }) {
  const reasonsFor = toList(analysis.reasons_for);
  const reasonsAgainst = toList(analysis.reasons_against);
  const triggers = toList(analysis.follow_up_triggers);

  return (
    <div className="space-y-4 not-prose">
      {analysis.summary && <p className="text-sm text-white leading-relaxed">{analysis.summary}</p>}

      {(analysis.bias || analysis.confidence) && (
        <div className="flex flex-wrap gap-2">
          {analysis.bias && <BiasBadge bias={analysis.bias} />}
          {analysis.confidence && <ConfidenceBadge confidence={analysis.confidence} />}
        </div>
      )}

      {(reasonsFor.length > 0 || reasonsAgainst.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md p-3" style={{ background: "hsl(var(--muted) / 0.3)" }}>
          <ReasonList title="Reasons for" items={reasonsFor} positive />
          <ReasonList title="Reasons against" items={reasonsAgainst} positive={false} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <Field icon={ShieldAlert} label="Key risk" value={analysis.key_risk} />
        <Field icon={Globe} label="Macro factor" value={analysis.macro_factor} />
        <Field icon={Target} label="Suggested action" value={analysis.suggested_action} />
        <Field icon={Scale} label="Position size note" value={analysis.position_size_note} />
      </div>

      {triggers.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold" style={{ color: muted }}>
            <Bell className="h-3 w-3" />
            Follow-up triggers
          </p>
          <ul className="mt-1.5 space-y-1">
            {triggers.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm text-white/85">
                <span className="text-primary">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
