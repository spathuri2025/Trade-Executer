import {
  useSendWatchdogTestAlert,
  useSendDailyReportNow,
  useGetAdminTransactionsSummary,
  getGetAdminTransactionsSummaryQueryKey,
} from "@workspace/api-client-react";
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
  const report = useSendDailyReportNow();
  // Fetched only on demand: it reads a week of broker history a day at a time.
  const labels = useGetAdminTransactionsSummary(
    { days: 7 },
    { query: { queryKey: getGetAdminTransactionsSummaryQueryKey({ days: 7 }), enabled: false, retry: false } },
  );

  return (
    <CollapsibleSection
      id="admin.outageAlerts"
      title={<span className="flex items-center gap-2"><BellRing className="h-4 w-4" /> Outage alerts</span>}
      defaultOpen={false}
      description={
        <>
          If the database becomes unreachable for 3 minutes, or a running bot stops cycling, an email goes out with
          what to do. The morning report arrives daily at 07:00 UTC with what the account actually made — both are
          emailed, so send one of each to confirm they reach you.
        </>
      }
      contentClassName="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => test.mutate()} disabled={test.isPending} data-testid="button-test-alert">
          {test.isPending ? "Sending…" : "Send test alert"}
        </Button>
        <Button
          variant="outline"
          onClick={() => report.mutate()}
          disabled={report.isPending}
          data-testid="button-send-daily-report"
        >
          {report.isPending ? "Sending…" : "Send morning report now"}
        </Button>
        <Button
          variant="outline"
          onClick={() => labels.refetch()}
          disabled={labels.isFetching}
          data-testid="button-transaction-labels"
        >
          {labels.isFetching ? "Reading…" : "Check broker transaction labels"}
        </Button>
      </div>

      {/* Your own account's last 7 days as Capital.com labels them, so each
          kind of charge can be matched against its exported history. Added
          23 Oct 2026 when oil price adjustments were found missing. */}
      {labels.isError && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          Couldn&rsquo;t read the broker&rsquo;s history. Check the broker connection and try again.
        </p>
      )}
      {labels.data && (
        <div className="text-xs" data-testid="transaction-labels">
          <p className="mb-2 text-muted-foreground">
            {labels.data.rows} rows, {labels.data.from.slice(0, 16).replace("T", " ")} to{" "}
            {labels.data.to.slice(0, 16).replace("T", " ")} UTC
          </p>
          <table className="w-full tabular-nums">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-normal">Type</th>
                <th className="py-1 pr-3 font-normal">Note</th>
                <th className="py-1 pr-3 font-normal text-right">Rows</th>
                <th className="py-1 font-normal text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {labels.data.labels.map((l) => (
                <tr key={`${l.transactionType}|${l.note}`} className="border-t border-border/40">
                  <td className="py-1 pr-3 font-mono">{l.transactionType}</td>
                  <td className="py-1 pr-3">{l.note}</td>
                  <td className="py-1 pr-3 text-right">{l.count}</td>
                  <td className="py-1 text-right">{l.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.data && report.data.sent > 0 && (
        <p className="flex items-start gap-2 text-sm text-primary" data-testid="daily-report-result">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          {`Report sent to ${report.data.sent} account${report.data.sent === 1 ? "" : "s"}. It's also in your Inbox.`}
        </p>
      )}
      {report.data && report.data.failed > 0 && (
        <p className="flex items-start gap-2 text-sm text-destructive" data-testid="daily-report-failed">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {`The report failed for ${report.data.failed} account${report.data.failed === 1 ? "" : "s"} — usually the broker refusing a request. Try again in a minute.`}
        </p>
      )}
      {report.data && report.data.sent === 0 && report.data.failed === 0 && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="daily-report-result">
          Nothing sent — no account has a broker connected with transaction history.
        </p>
      )}

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
