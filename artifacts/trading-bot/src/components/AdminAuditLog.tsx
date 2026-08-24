import { useListAuditLog, getListAuditLogQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText } from "lucide-react";

/**
 * The admin audit trail. Exists because an account once vanished with no way to
 * establish who deleted it — request logs had rolled and the app kept no
 * history of its own.
 */

/** Plain-English labels; destructive actions are colour-flagged. */
const ACTION_LABEL: Record<string, { text: string; destructive?: boolean }> = {
  customer_deleted: { text: "deleted account", destructive: true },
  customer_suspended: { text: "suspended account", destructive: true },
  customer_unsuspended: { text: "unsuspended account" },
  subscription_updated: { text: "changed subscription" },
  upgrade_request_resolved: { text: "resolved upgrade request" },
  announcement_sent: { text: "sent announcement" },
  support_replied: { text: "replied to support thread" },
  support_thread_status_changed: { text: "changed thread status" },
};

export function AdminAuditLog() {
  const { data, isLoading } = useListAuditLog({
    query: { queryKey: getListAuditLogQueryKey() },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-4 w-4" /> Audit Log
        </CardTitle>
        <CardDescription>
          Every admin action, permanently recorded. Read-only — entries cannot be edited or deleted,
          including by an admin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !data || data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No admin actions recorded yet. Everything from here on will be.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {data.entries.map((e) => {
              const label = ACTION_LABEL[e.action] ?? { text: e.action };
              return (
                <div
                  key={e.id}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                  data-testid={`audit-${e.id}`}
                >
                  <div className="flex items-baseline gap-x-1.5 flex-wrap">
                    <span className="font-medium">{e.actorEmail}</span>
                    <span className={label.destructive ? "text-destructive" : "text-muted-foreground"}>
                      {label.text}
                    </span>
                    {e.targetEmail && <span className="font-medium">{e.targetEmail}</span>}
                    <span className="ml-auto text-xs text-muted-foreground shrink-0">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {e.detail && <div className="text-xs text-muted-foreground mt-0.5">{e.detail}</div>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
