import { useListPlans, getListPlansQueryKey, useGetPlan, getGetPlanQueryKey } from "@workspace/api-client-react";
import type { PlanCatalogEntry } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RequestUpgradeButton } from "@/components/RequestUpgradeButton";
import { Check } from "lucide-react";

/** Ranks tiers so "your plan or below" can render without an upgrade CTA. */
const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };

function formatLimit(n: number | null | undefined, unit: string): string {
  return n == null ? `Unlimited ${unit}` : `${n} ${unit}`;
}

function PlanColumn({
  entry,
  currentPlan,
}: {
  entry: PlanCatalogEntry;
  currentPlan: string | undefined;
}) {
  const isCurrent = currentPlan === entry.plan;
  const isBelowCurrent = currentPlan != null && PLAN_RANK[entry.plan]! < PLAN_RANK[currentPlan]!;
  const isEnterprise = entry.plan === "enterprise";

  return (
    <Card
      className={[
        "flex flex-col relative",
        entry.recommended ? "border-primary shadow-lg shadow-primary/10" : "",
        isCurrent ? "bg-primary/5" : "",
      ].join(" ")}
      data-testid={`plan-card-${entry.plan}`}
    >
      {entry.recommended && (
        <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">Most popular</Badge>
      )}
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{entry.displayName}</CardTitle>
          {isCurrent && (
            <Badge variant="secondary" data-testid={`badge-current-${entry.plan}`}>
              Current plan
            </Badge>
          )}
        </div>
        <CardDescription>{entry.tagline}</CardDescription>
        <div className="pt-2">
          {entry.monthlyPriceGbp == null ? (
            <span className="text-3xl font-light">Custom</span>
          ) : entry.monthlyPriceGbp === 0 ? (
            <span className="text-3xl font-light">£0</span>
          ) : (
            <>
              <span className="text-3xl font-light">£{entry.monthlyPriceGbp}</span>
              <span className="text-sm text-muted-foreground"> / month</span>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col flex-1 gap-4">
        <ul className="space-y-2 text-sm flex-1">
          {entry.features.map((feature) => (
            <li key={feature} className="flex gap-2">
              <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span>{feature}</span>
            </li>
          ))}
          <li className="flex gap-2 text-muted-foreground">
            <Check className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{formatLimit(entry.limits.maxInstruments, "tracked instruments")}</span>
          </li>
          <li className="flex gap-2 text-muted-foreground">
            <Check className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{formatLimit(entry.limits.aiQueriesPerDay, "AI requests / day")}</span>
          </li>
        </ul>

        {/* No self-serve checkout yet, so paid tiers funnel through the existing
            upgrade-request flow the Admin Centre already handles. When Stripe
            goes live, stripePriceId stops being null and this becomes a
            checkout button (see BILLING.md). */}
        {isCurrent ? null : isBelowCurrent ? null : isEnterprise ? (
          <RequestUpgradeButton
            trigger="enterprise"
            variant="outline"
            size="default"
            className="w-full"
            label="Contact us"
          />
        ) : entry.monthlyPriceGbp === 0 ? null : (
          <RequestUpgradeButton
            trigger="plan_card"
            variant={entry.recommended ? "default" : "outline"}
            size="default"
            className="w-full"
            label={`Upgrade to ${entry.displayName}`}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function Pricing() {
  const { data: catalog, isLoading } = useListPlans({
    query: { queryKey: getListPlansQueryKey() },
  });
  const { data: mine } = useGetPlan({ query: { queryKey: getGetPlanQueryKey() } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-light">Plan &amp; Pricing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every plan is enforced server-side — what you see here is exactly what each tier can do.
        </p>
      </div>

      {mine && (
        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Your plan: </span>
              <span className="font-medium">{mine.planDisplay}</span>
            </div>
            {mine.renewsAt && (
              <div>
                <span className="text-muted-foreground">
                  {mine.status === "trialing" ? "Trial ends: " : "Renews: "}
                </span>
                <span className="font-medium">{new Date(mine.renewsAt).toLocaleDateString()}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Instruments: </span>
              <span className="font-mono">
                {mine.usage.instruments}
                {mine.limits.maxInstruments == null ? " / ∞" : ` / ${mine.limits.maxInstruments}`}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">AI requests today: </span>
              <span className="font-mono">
                {mine.usage.aiQueriesToday}
                {mine.limits.aiQueriesPerDay == null ? " / ∞" : ` / ${mine.limits.aiQueriesPerDay}`}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-96" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 items-stretch pt-2">
          {catalog?.plans.map((entry) => (
            <PlanColumn key={entry.plan} entry={entry} currentPlan={mine?.plan} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Prices in GBP. Upgrades are handled personally while TradeBuzz is in early access — request
        one and we'll be in touch, usually the same day. Trading involves risk; software
        subscriptions do not include financial advice.
      </p>
    </div>
  );
}
