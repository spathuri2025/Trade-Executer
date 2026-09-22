import { useSendWatchdogTestAlert } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { BellRing, CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * Proves outage alerts arrive before an outage needs them. On 22 Sep 2026 the
 * database was unreachable for half an hour and nobody was told; the watchdog
 * now emails, and this button checks the email actually lands.
 */
export function AdminOutageAlerts() {
  const test = useSendWatchdogTestAlert();
  const r = test.data;

  return (
    <CollapsibleSection
      id="admin.outageAlerts"
      title={<span className="flex items-center gap-2"><BellRing className="h-4 w-4" /> Outage alerts</span>}
      defaultOpen={false}
      description={
        <>
          If the database becomes unreachable for 3 minutes, or a running bot stops cycling, an email goes out with
          what to do. Send a test to confirm it reaches you.
        </>
      }
      contentClassName="space-y-4"
    >
      <Button onClick={() => test.mutate()} disabled={test.isPending} data-testid="button-test-alert">
        {test.isPending ? "Sending…" : "Send test alert"}
      </Button>

      {test.isError && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          Couldn&rsquo;t send the test. Check that you&rsquo;re signed in as an admin and try again.
        </p>
      )}

      {r && (
        <div className="space-y-2 text-sm" data-testid="test-alert-result">
          {!r.running ? (
            <p className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              The watchdog isn&rsquo;t running on this server, so no alert could be sent.
            </p>
          ) : r.sent === 0 ? (
            <p className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              {r.recipients.length === 0
                ? "There's nobody to alert. Set ALERT_EMAIL in Render."
                : "The email provider didn't accept the message. Check RESEND_API_KEY and EMAIL_FROM in Render."}
            </p>
          ) : (
            <p className="flex items-start gap-2 text-primary">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              Sent to {r.recipients.join(", ")}. Check that inbox, and spam.
            </p>
          )}
          {!r.alertEmailConfigured && (
            <p className="flex items-start gap-2 text-amber-500">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              ALERT_EMAIL isn&rsquo;t set in Render. Alerts still reach admins the app has already seen, but an outage
              that begins as the server starts would alert nobody. Set it to be sure.
            </p>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}
