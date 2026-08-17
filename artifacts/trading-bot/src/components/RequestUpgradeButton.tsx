import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateUpgradeRequest,
  useGetMyUpgradeRequest,
  getGetMyUpgradeRequestQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/** Which paywall the user hit — sent to the admin so they can see what blocked them. */
export type UpgradeTrigger =
  | "live_trading"
  | "ai_trade_modes"
  | "instrument_cap"
  | "ai_quota"
  | "plan_card";

/** Plain-English description of the limit, shown in the dialog to confirm what they're asking for. */
const TRIGGER_LABEL: Record<UpgradeTrigger, string> = {
  live_trading: "placing real trades (your plan is currently research-only)",
  ai_trade_modes: "the AI trade modes",
  instrument_cap: "tracking more instruments",
  ai_quota: "a higher daily AI request allowance",
  plan_card: "a higher plan",
};

/**
 * Raised at the moment a user hits a limit, so the request carries the reason
 * with it rather than arriving as a bare "wants more".
 *
 * There's no self-serve checkout yet — plans are granted by hand in the Admin
 * Centre — so this is the bridge between a blocked user and the admin who can
 * unblock them.
 */
export function RequestUpgradeButton({
  trigger,
  variant = "outline",
  size = "sm",
  className,
  label = "Request upgrade",
}: {
  trigger: UpgradeTrigger;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: mine } = useGetMyUpgradeRequest({
    query: { queryKey: getGetMyUpgradeRequestQueryKey() },
  });

  const createRequest = useCreateUpgradeRequest({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        setMessage("");
        queryClient.invalidateQueries({ queryKey: getGetMyUpgradeRequestQueryKey() });
        toast({
          title: "Request sent",
          description: "We'll be in touch about upgrading your plan.",
        });
      },
      onError: (err: any) => {
        const serverMessage =
          err?.response?.data?.error ?? err?.data?.error ?? err?.error ?? err?.message;
        toast({ title: "Couldn't send your request", description: serverMessage, variant: "destructive" });
      },
    },
  });

  // Already waiting on us — say so rather than inviting a duplicate request.
  if (mine?.pending) {
    return (
      <span className={`text-xs text-muted-foreground ${className ?? ""}`}>
        Upgrade requested — we'll be in touch
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request an upgrade</DialogTitle>
          <DialogDescription>
            You're asking about {TRIGGER_LABEL[trigger]}. We'll get back to you about moving you
            onto a plan that covers it.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Anything you'd like us to know? (optional)"
          maxLength={1000}
          rows={4}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createRequest.mutate({ data: { trigger, message: message.trim() || undefined } })}
            disabled={createRequest.isPending}
          >
            {createRequest.isPending ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
