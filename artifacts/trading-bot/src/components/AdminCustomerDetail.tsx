import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateCustomerSubscription,
  useListCustomerContracts,
  getListCustomerContractsQueryKey,
  useDeleteContract,
  getListAdminCustomersQueryKey,
  type AdminCustomer,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Download, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PLANS = ["free", "starter", "pro", "enterprise"] as const;
const STATUSES = ["active", "trialing", "past_due", "canceled"] as const;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function AdminCustomerDetail({
  customer,
  open,
  onOpenChange,
}: {
  customer: AdminCustomer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [plan, setPlan] = useState(customer.subscription.plan);
  const [status, setStatus] = useState(customer.subscription.status);
  const [notes, setNotes] = useState(customer.subscription.notes ?? "");
  const [renewsAt, setRenewsAt] = useState(customer.subscription.renewsAt?.slice(0, 10) ?? "");

  const [uploadNotes, setUploadNotes] = useState("");
  const [uploading, setUploading] = useState(false);

  const contractsQueryKey = getListCustomerContractsQueryKey(customer.id);
  const { data: contractsData, isLoading: contractsLoading } = useListCustomerContracts(customer.id, {
    query: { queryKey: contractsQueryKey, enabled: open },
  });

  const updateSubscription = useUpdateCustomerSubscription({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminCustomersQueryKey() });
        toast({ title: "Subscription updated" });
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast({ title: "Failed to update subscription", description: message, variant: "destructive" });
      },
    },
  });

  const deleteContract = useDeleteContract({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: contractsQueryKey });
        toast({ title: "Contract deleted" });
      },
    },
  });

  const handleSaveSubscription = (e: React.FormEvent) => {
    e.preventDefault();
    updateSubscription.mutate({
      id: customer.id,
      data: {
        plan,
        status,
        notes: notes.trim() ? notes.trim() : null,
        renewsAt: renewsAt ? renewsAt : null,
      },
    });
  };

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    if (uploadNotes.trim()) formData.append("notes", uploadNotes.trim());

    setUploading(true);
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}/contracts`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      form.reset();
      setUploadNotes("");
      queryClient.invalidateQueries({ queryKey: contractsQueryKey });
      toast({ title: "Contract uploaded" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to upload contract", description: message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer.email}</DialogTitle>
          <DialogDescription>
            Customer since {new Date(customer.createdAt).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSaveSubscription} className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subscription</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Plan</Label>
              <Select value={plan} onValueChange={(v) => setPlan(v as typeof plan)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Renews at</Label>
            <Input type="date" value={renewsAt} onChange={(e) => setRenewsAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. paying via bank transfer"
              rows={2}
            />
          </div>
          <Button type="submit" size="sm" disabled={updateSubscription.isPending}>
            {updateSubscription.isPending ? "Saving…" : "Save subscription"}
          </Button>
        </form>

        <div className="space-y-3 pt-4 border-t border-border">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contracts</p>

          {contractsLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : contractsData?.contracts.length ? (
            <ul className="space-y-2">
              {contractsData.contracts.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-md border border-border text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(c.fileSize)} · {new Date(c.uploadedAt).toLocaleDateString()}
                      {c.notes ? ` · ${c.notes}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" asChild>
                      <a href={`/api/admin/contracts/${c.id}/download`} target="_blank" rel="noreferrer">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteContract.mutate({ contractId: c.id })}
                      disabled={deleteContract.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No contracts uploaded yet.</p>
          )}

          <form onSubmit={handleUpload} className="space-y-2 pt-1">
            <Input name="file" type="file" required />
            <Input
              placeholder="Notes (optional)"
              value={uploadNotes}
              onChange={(e) => setUploadNotes(e.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" disabled={uploading}>
              <Upload className="mr-2 h-3.5 w-3.5" />
              {uploading ? "Uploading…" : "Upload contract"}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
