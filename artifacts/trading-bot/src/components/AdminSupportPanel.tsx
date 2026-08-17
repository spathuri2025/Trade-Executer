import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminSupportThreads,
  getListAdminSupportThreadsQueryKey,
  useGetAdminSupportThread,
  getGetAdminSupportThreadQueryKey,
  useSendAdminSupportReply,
  useSetSupportThreadStatus,
  useListAnnouncements,
  getListAnnouncementsQueryKey,
  useCreateAnnouncement,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Megaphone } from "lucide-react";

/**
 * Operator side of the communication centre: the support inbox and the
 * announcement composer. Rendered inside the Admin Centre — the server-side
 * requireAdmin gate is the real access control.
 */

function AdminThreadView({ threadId, onBack }: { threadId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const threadKey = getGetAdminSupportThreadQueryKey(threadId);
  const { data: thread, isLoading } = useGetAdminSupportThread(threadId, {
    query: { queryKey: threadKey },
  });
  const [reply, setReply] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: threadKey });
    queryClient.invalidateQueries({ queryKey: getListAdminSupportThreadsQueryKey() });
  };

  const sendReply = useSendAdminSupportReply({
    mutation: {
      onSuccess: () => {
        setReply("");
        invalidate();
        toast({ title: "Reply sent", description: "The customer has been notified in-app and by email." });
      },
      onError: () => toast({ title: "Couldn't send the reply", variant: "destructive" }),
    },
  });

  const setStatus = useSetSupportThreadStatus({
    mutation: { onSuccess: invalidate },
  });

  if (isLoading || !thread) return <Skeleton className="h-48" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-admin-back-to-threads">
          <ArrowLeft className="h-4 w-4 mr-1" /> All threads
        </Button>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{thread.subject}</div>
          <div className="text-xs text-muted-foreground">{thread.userEmail}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {thread.status === "closed" && <Badge variant="secondary">Closed</Badge>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStatus.mutate({ id: threadId, data: { status: thread.status === "open" ? "closed" : "open" } })}
            disabled={setStatus.isPending}
            data-testid="button-toggle-thread-status"
          >
            {thread.status === "open" ? "Close thread" : "Reopen"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {thread.messages.map((m) => (
          <div key={m.id} className={`flex ${m.senderRole === "admin" ? "justify-end" : "justify-start"}`}>
            <div
              className={[
                "rounded-lg px-4 py-2.5 max-w-[85%] text-sm whitespace-pre-wrap",
                m.senderRole === "admin" ? "bg-primary/10 border border-primary/20" : "bg-muted/40 border border-border",
              ].join(" ")}
            >
              <p>{m.body}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {m.senderRole === "user" ? `${thread.userEmail} · ` : "You · "}
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
          if (reply.trim()) sendReply.mutate({ id: threadId, data: { body: reply.trim() } });
        }}
      >
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply — the customer is notified in-app and by email…"
          rows={2}
          className="flex-1"
          data-testid="input-admin-reply"
        />
        <Button type="submit" disabled={sendReply.isPending || !reply.trim()} data-testid="button-admin-send-reply">
          Send
        </Button>
      </form>
    </div>
  );
}

export function AdminSupportPanel() {
  const { data, isLoading } = useListAdminSupportThreads({
    query: { queryKey: getListAdminSupportThreadsQueryKey(), refetchInterval: 60_000 },
  });
  const [openThreadId, setOpenThreadId] = useState<number | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Support Inbox</CardTitle>
        <CardDescription>Customer messages. Replies go out in-app and by email.</CardDescription>
      </CardHeader>
      <CardContent>
        {openThreadId != null ? (
          <AdminThreadView threadId={openThreadId} onBack={() => setOpenThreadId(null)} />
        ) : isLoading ? (
          <Skeleton className="h-24" />
        ) : !data || data.threads.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No support messages yet.</p>
        ) : (
          <div className="space-y-2">
            {data.threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setOpenThreadId(t.id)}
                className={[
                  "w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40",
                  t.unread ? "border-primary/40 bg-primary/5" : "border-border",
                ].join(" ")}
                data-testid={`admin-thread-${t.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{t.subject}</span>
                  {t.unread && <Badge>New</Badge>}
                  {t.status === "closed" && <Badge variant="secondary">Closed</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground shrink-0">
                    {new Date(t.lastMessageAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.userEmail}</div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminAnnouncementsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const announcementsKey = getListAnnouncementsQueryKey();
  const { data, isLoading } = useListAnnouncements({ query: { queryKey: announcementsKey } });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const create = useCreateAnnouncement({
    mutation: {
      onSuccess: (result) => {
        setTitle("");
        setBody("");
        queryClient.invalidateQueries({ queryKey: announcementsKey });
        toast({
          title: "Announcement sent",
          description: `Delivered to ${result.recipients} user${result.recipients === 1 ? "" : "s"}, in-app and by email.`,
        });
      },
      onError: () => toast({ title: "Couldn't send the announcement", variant: "destructive" }),
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-4 w-4" /> Announcements
        </CardTitle>
        <CardDescription>
          One message to every active user — new features, maintenance windows, pricing changes.
          Sends immediately, in-app and by email. There is no undo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && body.trim()) create.mutate({ data: { title: title.trim(), body: body.trim() } });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="announcement-title">Title</Label>
            <Input
              id="announcement-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              data-testid="input-announcement-title"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="announcement-body">Message</Label>
            <Textarea
              id="announcement-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={5000}
              required
              data-testid="input-announcement-body"
            />
          </div>
          <Button type="submit" disabled={create.isPending || !title.trim() || !body.trim()} data-testid="button-send-announcement">
            {create.isPending ? "Sending…" : "Send to all users"}
          </Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-16" />
        ) : data && data.announcements.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Previously sent</div>
            {data.announcements.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{a.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{a.body}</p>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
