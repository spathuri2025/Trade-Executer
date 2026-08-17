import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNotifications,
  getListNotificationsQueryKey,
  useMarkNotificationsRead,
  useListSupportThreads,
  getListSupportThreadsQueryKey,
  useCreateSupportThread,
  useGetSupportThread,
  getGetSupportThreadQueryKey,
  useSendSupportMessage,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Megaphone, MessageSquare, AlertTriangle, BadgeCheck, ArrowLeft } from "lucide-react";

const TYPE_ICON: Record<string, typeof Megaphone> = {
  announcement: Megaphone,
  support_reply: MessageSquare,
  circuit_breaker: AlertTriangle,
  upgrade_handled: BadgeCheck,
};

function NotificationsTab() {
  const queryClient = useQueryClient();
  const notificationsKey = getListNotificationsQueryKey();
  const { data, isLoading } = useListNotifications({
    query: { queryKey: notificationsKey },
  });
  const markRead = useMarkNotificationsRead({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationsKey }) },
  });

  if (isLoading) return <Skeleton className="h-48" />;
  if (!data || data.notifications.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Nothing yet — replies from support, announcements and important bot events will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {data.unreadCount > 0 && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markRead.mutate()}
            disabled={markRead.isPending}
            data-testid="button-mark-all-read"
          >
            Mark all read
          </Button>
        </div>
      )}
      {data.notifications.map((n) => {
        const Icon = TYPE_ICON[n.type] ?? MessageSquare;
        return (
          <div
            key={n.id}
            className={[
              "rounded-lg border p-4 flex gap-3",
              n.read ? "border-border" : "border-primary/40 bg-primary/5",
            ].join(" ")}
            data-testid={`notification-${n.id}`}
          >
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${n.type === "circuit_breaker" ? "text-destructive" : "text-primary"}`} />
            <div className="min-w-0">
              <div className="text-sm font-medium flex items-center gap-2">
                {n.title}
                {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">{n.body}</p>
              <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ThreadView({ threadId, onBack }: { threadId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const threadKey = getGetSupportThreadQueryKey(threadId);
  const { data: thread, isLoading } = useGetSupportThread(threadId, {
    query: { queryKey: threadKey },
  });
  const [reply, setReply] = useState("");

  const sendMessage = useSendSupportMessage({
    mutation: {
      onSuccess: () => {
        setReply("");
        queryClient.invalidateQueries({ queryKey: threadKey });
        queryClient.invalidateQueries({ queryKey: getListSupportThreadsQueryKey() });
      },
      onError: () => toast({ title: "Couldn't send your message", variant: "destructive" }),
    },
  });

  if (isLoading || !thread) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-threads">
          <ArrowLeft className="h-4 w-4 mr-1" /> All messages
        </Button>
        <span className="text-sm font-medium truncate">{thread.subject}</span>
        {thread.status === "closed" && <Badge variant="secondary">Closed</Badge>}
      </div>

      <div className="space-y-3">
        {thread.messages.map((m) => (
          <div key={m.id} className={`flex ${m.senderRole === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={[
                "rounded-lg px-4 py-2.5 max-w-[85%] text-sm whitespace-pre-wrap",
                m.senderRole === "user" ? "bg-primary/10 border border-primary/20" : "bg-muted/40 border border-border",
              ].join(" ")}
            >
              <p>{m.body}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {m.senderRole === "admin" ? "TradeBuzz support · " : ""}
                {new Date(m.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (reply.trim()) sendMessage.mutate({ id: threadId, data: { body: reply.trim() } });
        }}
      >
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={thread.status === "closed" ? "Reply to reopen this conversation…" : "Write a reply…"}
          rows={2}
          className="flex-1"
          data-testid="input-thread-reply"
        />
        <Button type="submit" disabled={sendMessage.isPending || !reply.trim()} data-testid="button-send-reply">
          Send
        </Button>
      </form>
    </div>
  );
}

function SupportTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const threadsKey = getListSupportThreadsQueryKey();
  const { data, isLoading } = useListSupportThreads({ query: { queryKey: threadsKey } });

  const [openThreadId, setOpenThreadId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const createThread = useCreateSupportThread({
    mutation: {
      onSuccess: (thread) => {
        setComposeOpen(false);
        setSubject("");
        setBody("");
        queryClient.invalidateQueries({ queryKey: threadsKey });
        setOpenThreadId(thread.id);
        toast({ title: "Message sent", description: "We'll get back to you — replies appear here and by email." });
      },
      onError: () => toast({ title: "Couldn't send your message", variant: "destructive" }),
    },
  });

  if (openThreadId != null) {
    return <ThreadView threadId={openThreadId} onBack={() => setOpenThreadId(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-new-support-thread">
              New message
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Message TradeBuzz support</DialogTitle>
              <DialogDescription>
                Questions, problems, feedback — anything. Replies arrive here and by email.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (subject.trim() && body.trim()) {
                  createThread.mutate({ data: { subject: subject.trim(), body: body.trim() } });
                }
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="support-subject">Subject</Label>
                <Input
                  id="support-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  required
                  data-testid="input-support-subject"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="support-body">Message</Label>
                <Textarea
                  id="support-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  maxLength={5000}
                  required
                  data-testid="input-support-body"
                />
              </div>
              <Button type="submit" className="w-full" disabled={createThread.isPending} data-testid="button-send-support">
                {createThread.isPending ? "Sending…" : "Send"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : !data || data.threads.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No conversations yet. Anything on your mind — a question, a bug, an idea — send us a message.
        </p>
      ) : (
        data.threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpenThreadId(t.id)}
            className={[
              "w-full rounded-lg border p-4 text-left transition-colors hover:border-primary/40",
              t.unread ? "border-primary/40 bg-primary/5" : "border-border",
            ].join(" ")}
            data-testid={`thread-${t.id}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{t.subject}</span>
              {t.unread && <Badge>New reply</Badge>}
              {t.status === "closed" && <Badge variant="secondary">Closed</Badge>}
              <span className="ml-auto text-xs text-muted-foreground shrink-0">
                {new Date(t.lastMessageAt).toLocaleDateString()}
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

export default function Inbox() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-light">Inbox</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Notifications, announcements and your conversations with TradeBuzz support.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="sr-only">Inbox</CardTitle>
          <CardDescription className="sr-only">Notifications and support</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="notifications">
            <TabsList>
              <TabsTrigger value="notifications" data-testid="tab-notifications">Notifications</TabsTrigger>
              <TabsTrigger value="support" data-testid="tab-support">Support</TabsTrigger>
            </TabsList>
            <TabsContent value="notifications" className="pt-4">
              <NotificationsTab />
            </TabsContent>
            <TabsContent value="support" className="pt-4">
              <SupportTab />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
