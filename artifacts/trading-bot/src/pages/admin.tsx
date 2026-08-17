import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminCustomers,
  getListAdminCustomersQueryKey,
  useSuspendCustomer,
  useUnsuspendCustomer,
  useDeleteCustomer,
  useListUpgradeRequests,
  getListUpgradeRequestsQueryKey,
  useResolveUpgradeRequest,
  type AdminCustomer,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AdminCustomerDetail } from "@/components/AdminCustomerDetail";
import { useToast } from "@/hooks/use-toast";
import { Ban, CheckCircle2, Trash2 } from "lucide-react";

const card = "hsl(var(--card))";
const cardBorder = "1px solid hsl(var(--card-border))";
const divider = "1px solid hsl(var(--border))";
const muted = "hsl(var(--muted-foreground))";

/**
 * Which paywall the customer hit, in plain English. Commercially this is the
 * useful part of a request — it shows what people are actually blocked by.
 */
const UPGRADE_TRIGGER_LABEL: Record<string, string> = {
  live_trading: "live trading",
  ai_trade_modes: "AI trade modes",
  instrument_cap: "instrument limit",
  ai_quota: "daily AI limit",
  plan_card: "asked from plan card",
};

const BROKER_LABELS: Record<string, string> = {
  trading212: "Trading 212",
  capitalcom: "Capital.com",
};

const STATUS_STYLES: Record<string, string> = {
  active: "text-primary border-primary bg-primary/10",
  trialing: "text-sky-400 border-sky-400 bg-sky-400/10",
  past_due: "text-amber-500 border-amber-500 bg-amber-500/10",
  canceled: "text-muted-foreground border-muted-foreground/40",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: muted }}>
      {children}
    </p>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedCustomer, setSelectedCustomer] = useState<AdminCustomer | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminCustomer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminCustomer | null>(null);

  const customersQueryKey = getListAdminCustomersQueryKey();
  const { data, isLoading } = useListAdminCustomers({
    query: { queryKey: customersQueryKey, enabled: user?.role === "admin" },
  });

  const upgradeQueryKey = getListUpgradeRequestsQueryKey();
  const { data: upgradeData } = useListUpgradeRequests({
    query: { queryKey: upgradeQueryKey, enabled: user?.role === "admin" },
  });

  const resolveRequest = useResolveUpgradeRequest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: upgradeQueryKey });
        // The plan may have been granted on the customer record — refresh that too.
        queryClient.invalidateQueries({ queryKey: customersQueryKey });
      },
      onError: (err: any) => {
        const serverMessage =
          err?.response?.data?.error ?? err?.data?.error ?? err?.error ?? err?.message;
        toast({ title: "Couldn't update the request", description: serverMessage, variant: "destructive" });
      },
    },
  });

  const suspendMutation = useSuspendCustomer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: customersQueryKey });
        toast({ title: "Customer suspended", description: "Their bot and live stream have been stopped." });
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast({ title: "Failed to suspend customer", description: message, variant: "destructive" });
      },
    },
  });

  const unsuspendMutation = useUnsuspendCustomer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: customersQueryKey });
        toast({ title: "Customer unsuspended" });
      },
    },
  });

  const deleteMutation = useDeleteCustomer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: customersQueryKey });
        toast({ title: "Customer deleted" });
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast({ title: "Failed to delete customer", description: message, variant: "destructive" });
      },
    },
  });

  // Server-side requireAdmin is the real gate — this is just UX so a
  // non-admin never sees a flash of the customer table.
  if (user && user.role !== "admin") {
    return <Redirect to="/" />;
  }

  const customers = data?.customers ?? [];
  const upgradeRequests = upgradeData?.requests ?? [];
  const pendingCount = upgradeData?.pendingCount ?? 0;

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl md:text-4xl font-light tracking-tight">Admin Centre</h1>
        {pendingCount > 0 && (
          <Badge variant="outline" className="text-amber-500 border-amber-500/40 bg-amber-500/10">
            {pendingCount} upgrade {pendingCount === 1 ? "request" : "requests"}
          </Badge>
        )}
      </div>

      {/* Upgrade requests — a work queue, so only pending ones appear. There's
          no self-serve checkout yet, so this is how a blocked user reaches you. */}
      {upgradeRequests.length > 0 && (
        <div className="rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
          <div className="px-5 py-4" style={{ borderBottom: divider }}>
            <SectionLabel>Upgrade Requests</SectionLabel>
          </div>
          {upgradeRequests.map((r, idx) => (
            <div
              key={r.id}
              className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap"
              style={idx < upgradeRequests.length - 1 ? { borderBottom: divider } : {}}
            >
              <div className="space-y-1 min-w-0">
                <div className="text-sm font-medium">{r.email}</div>
                <div className="text-xs" style={{ color: muted }}>
                  On <span className="font-mono">{r.currentPlan}</span> · blocked by{" "}
                  <span className="font-mono">{UPGRADE_TRIGGER_LABEL[r.trigger] ?? r.trigger}</span> ·{" "}
                  {new Date(r.createdAt).toLocaleString()}
                </div>
                {r.message && (
                  <div className="text-xs mt-1 italic" style={{ color: muted }}>
                    "{r.message}"
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolveRequest.mutate({ id: r.id, data: { status: "handled" } })}
                  disabled={resolveRequest.isPending}
                >
                  Mark handled
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resolveRequest.mutate({ id: r.id, data: { status: "dismissed" } })}
                  disabled={resolveRequest.isPending}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="p-8 rounded-lg text-center text-sm" style={{ backgroundColor: card, border: cardBorder, color: muted }}>
          No customers yet.
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ backgroundColor: card, border: cardBorder }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr style={{ borderBottom: divider }}>
                  {["Customer", "Broker", "Bot", "Plan", "Trades", "Signals", "Last Activity", "Actions"].map((h) => (
                    <th key={h} className="px-5 py-4">
                      <SectionLabel>{h}</SectionLabel>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((c, idx) => (
                  <tr
                    key={c.id}
                    style={idx < customers.length - 1 ? { borderBottom: divider } : {}}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() => setSelectedCustomer(c)}
                  >
                    <td className="px-5 py-4">
                      <div className="font-medium">{c.email}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        {c.role === "admin" && (
                          <Badge variant="outline" className="text-xs">
                            admin
                          </Badge>
                        )}
                        {c.suspendedAt && (
                          <Badge variant="outline" className="text-xs text-destructive border-destructive bg-destructive/10">
                            suspended
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs" style={{ color: muted }}>
                      {c.broker ? BROKER_LABELS[c.broker.broker] ?? c.broker.broker : "Not connected"}
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        variant="outline"
                        className={c.botRunning ? "text-primary border-primary bg-primary/10" : "text-muted-foreground"}
                      >
                        {c.botRunning ? "Running" : "Stopped"}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant="outline" className={STATUS_STYLES[c.subscription.status] ?? ""}>
                        {c.subscription.plan} · {c.subscription.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 font-mono">{c.tradeCount}</td>
                    <td className="px-5 py-4 font-mono">{c.signalCount}</td>
                    <td className="px-5 py-4 whitespace-nowrap text-xs" style={{ color: muted }}>
                      {c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {c.suspendedAt ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Unsuspend"
                            onClick={() => unsuspendMutation.mutate({ id: c.id })}
                            disabled={unsuspendMutation.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          </Button>
                        ) : (
                          c.role !== "admin" && (
                            <Button variant="ghost" size="icon" title="Suspend" onClick={() => setSuspendTarget(c)}>
                              <Ban className="h-4 w-4 text-amber-500" />
                            </Button>
                          )
                        )}
                        {c.role !== "admin" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(c)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedCustomer && (
        <AdminCustomerDetail
          customer={selectedCustomer}
          open={!!selectedCustomer}
          onOpenChange={(open) => !open && setSelectedCustomer(null)}
        />
      )}

      <AlertDialog open={!!suspendTarget} onOpenChange={(open) => !open && setSuspendTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend {suspendTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately stops their trading bot and live price stream, and blocks them from logging in
              until unsuspended.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (suspendTarget) suspendMutation.mutate({ id: suspendTarget.id });
                setSuspendTarget(null);
              }}
            >
              Suspend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the account and all of their data — trades, signals, instruments,
              conversations, subscription, and contracts. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
                setDeleteTarget(null);
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
