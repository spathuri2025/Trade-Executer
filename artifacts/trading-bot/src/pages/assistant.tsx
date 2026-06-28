import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListConversations,
  getListConversationsQueryKey,
  useCreateConversation,
  useGetConversation,
  getGetConversationQueryKey,
  useDeleteConversation,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, Send, Trash2, Bot, User, MessageSquare, Loader2 } from "lucide-react";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const muted = "hsl(var(--muted-foreground))";

interface ChatMessage {
  id: number | string;
  role: "user" | "assistant";
  content: string;
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

export default function Assistant() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: conversations, isLoading: convosLoading } = useListConversations({
    query: { queryKey: getListConversationsQueryKey() },
  });

  const { data: conversation, isLoading: msgsLoading } = useGetConversation(activeId ?? 0, {
    query: {
      queryKey: getGetConversationQueryKey(activeId ?? 0),
      enabled: activeId != null,
    },
  });

  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();

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
    await queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
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

      const res = await fetch(`/api/assistant/conversations/${conversationId}/messages`, {
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
        queryKey: getGetConversationQueryKey(conversationId),
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
    await queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
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
          <SectionLabel>AI Assistant</SectionLabel>
          <h1 className="text-2xl font-semibold tracking-tight text-white mt-1">Trading Assistant</h1>
          <p className="text-sm mt-1" style={{ color: muted }}>
            Technical analysis, risk review, and strategy feedback grounded in your live data.
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
            New chat
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
                No conversations yet.
              </p>
            )}
          </div>
        </div>

        {/* Chat area */}
        <div
          className="flex flex-col rounded-lg overflow-hidden"
          style={{ background: card, border: cardBorder, height: "calc(100vh - 280px)", minHeight: 420 }}
        >
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
            {showEmpty ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Bot className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-white font-medium">How can I help with your trading?</h3>
                <p className="text-sm mt-2 max-w-md" style={{ color: muted }}>
                  Ask me to review a strategy, analyze your open positions, assess risk, or explain a recent signal.
                  I can see your account, trades, watchlist, and scanner results.
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
                  <MessageBubble role="assistant" content={streaming} pending={!streaming} />
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
                placeholder="Ask about your trades, risk, or strategy…"
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm text-white placeholder:text-white/30 outline-none px-2 py-2 max-h-32"
                style={{ minHeight: 40 }}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                size="icon"
                className="shrink-0"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-center" style={{ color: muted }}>
        Trading involves substantial risk. Responses are for informational purposes only and are not financial advice.
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
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? "bg-white/10" : "bg-primary/15"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5 text-white/70" /> : <Bot className="h-3.5 w-3.5 text-primary" />}
      </div>
      <div
        className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap ${
          isUser ? "bg-white/10 text-white" : "text-white/90"
        }`}
        style={isUser ? undefined : { background: "hsl(var(--muted) / 0.4)" }}
      >
        {pending ? (
          <span className="inline-flex items-center gap-1 text-white/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Thinking…
          </span>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
