# TradeBuzz monetisation — model, pricing and roadmap

Written Aug 2026 after a codebase-wide analysis. This is the working reference
for what is monetised now, what is prepared, and how the enterprise segments
get built when a customer justifies them.

## The model

**Sell trader subscriptions now; sell to organisations later; sell the
intelligence as an API last.** TradeBuzz's sellable value today is the working
single-trader loop: multi-strategy automated trading (MA crossover, ATR
momentum, VWAP reversion, regime-based routing), honest backtesting, a market
scanner, and seven Claude-powered features. All of it is already gated
server-side per plan.

Variable costs per user are Claude tokens (the five metered AI features plus
the AI trade modes) and broker API load (scales with tracked instruments).
The entitlement matrix (`planService.ts` → `PLAN_LIMITS`) meters exactly those
two things, so gross margin is protected by construction.

## Tiers and launch pricing

Customer-facing copy/pricing lives in `artifacts/api-server/src/lib/planCatalog.ts`
(display names, taglines, prices, feature bullets). Enforcement lives in
`planService.ts`. Change either independently.

| | Free | Starter £9/mo | Pro £29/mo | Enterprise (custom) |
|---|---|---|---|---|
| Backtests, charts, scanner, signals | ✔ | ✔ | ✔ | ✔ |
| Live trading | — | ✔ | ✔ | ✔ |
| AI trade modes (guard/autonomous) | — | — | ✔ | ✔ |
| Tracked instruments | 3 | 10 | 30 | Unlimited |
| AI requests / day | 10 | 50 | 200 | Unlimited |

**Pricing rationale (launch pricing — validate with real customers):**
- Free is a genuine research tool (full backtesting, dry-run bot) so the
  funnel has something to try; its AI allowance (10/day) caps worst-case cost
  at pennies.
- Starter at £9 prices live trading beneath "a coffee a week" for the
  self-directed retail trader; no AI trade modes keeps its token cost near zero.
- Pro at £29 carries the real Claude cost (AI in the trade loop on every cycle,
  200 queries/day) with comfortable margin, and sits well under comparable
  retail tools (Trade Ideas ~$89/mo) as befits an unproven product.
- Enterprise is deliberately unpriced — at this stage every enterprise deal is
  a conversation.

Trials: set status `trialing` + `renewsAt` = trial end in the Admin Centre;
lapse is automatic (planService reads `renewsAt` on every request — no cron).

## Segment map

| Segment | What they'd buy | Status |
|---|---|---|
| Individual traders | Starter/Pro subscriptions | **LIVE** — the current funnel |
| Professional traders | Pro + higher caps (a "Professional" tier is one entry in `PLAN_LIMITS` + `planCatalog`) | Add when someone hits Pro's caps |
| Prop firms / communities | Multi-seat organisations, shared config, admin dashboard | Phase 3 — needs orgs |
| Brokers / platforms | White-label deployments | Phase 3 — needs orgs + theming |
| Fintechs / API customers | Market brain, news intelligence, signal explanations over HTTP | Phase 3 — needs API keys |

## Phase 3 architecture directions (documented, deliberately not built)

Building multi-tenant tables at two users is debt, not preparation. The real
preparation is done: **every entitlement resolves through one function**
(`getEffectivePlan`), so each segment below is an extension, not a rewrite.

### Organisations (prop firms, communities, the foundation for everything else)
- `organizations` (id, name, plan, seats, settings) and
  `organization_members` (orgId, userId, role: owner/admin/member).
- `getEffectivePlan` gains one clause: an org member resolves to the org's plan.
- Org admin dashboard = the existing Admin Centre pattern (`requireAdmin`,
  `AdminCustomerDetail`) scoped to an org id.
- Seat enforcement mirrors the instrument cap (count members on invite, 402 at
  the limit).

### White-label (brokers)
- Branding (name, logo URL, colours) as columns on the org row, served by a
  public config endpoint keyed by host header; frontend reads CSS variables —
  the UI already uses tokens throughout.
- Custom domains: CNAME to Render + host→org lookup.
- Per-org broker defaults extend `bot_config` patterns.

### TradeBuzz API (fintechs)
- `api_keys` table storing SHA-256 of keys (mirror `passwordReset.ts` hashing),
  per-key daily quotas (mirror `consumeAiQuota`'s atomic upsert).
- `requireApiKey` middleware parallel to `requireAuth`; API routes mounted
  under `/api/v1/*` with key auth instead of cookies.
- First sellable endpoints — all already produced and stored, so this is
  exposure not construction: market brain snapshots (`market_brain_snapshots`),
  analysed news (`market_news` + `ai_market_analysis`), signal explanations,
  daily briefs.

## What guards the revenue (already enforced, server-side)
- Live trading + AI trade modes forced off at *execution* time in
  `botEngine.ts` / `scannerEngine.ts` — client manipulation is ineffective.
- Instrument cap on create; AI quota consumed atomically in all five
  user-initiated AI routes; config writes rejected with 402.
- Subscription expiry: past `renewsAt` lapses to free on the next request.
- Admin role → enterprise, so the operator can't lock themselves out.

## Next steps, in order
1. Deploy this round (pricing page + expiry + catalogue). Push schema first.
2. Get the first paying customers manually (request-upgrade → bank transfer /
   payment link → Admin Centre). Validate that £9/£29 survives contact with
   real buyers before automating it.
3. Stripe go-live (BILLING.md) once pricing has survived ~5 customers.
4. Revisit Phase 3 the day a prop firm, broker or API buyer actually asks.
