# Deploying TradeBuzz (Render + Supabase)

A clean-start deployment. GitHub `main` is the single source of truth; Render
auto-deploys from it.

## Architecture

**One** Render web service serves both the API (`/api/*`) and the built
frontend. This is required, not a preference: the generated API client calls
`/api/...` as a *relative* path and authentication is cookie-based, so the UI
and API must share an origin. Splitting them across two hosts would mean
cross-site cookies.

Two constraints on that service:

- **Paid plan.** The trading bot runs on in-process timers. A free instance
  sleeps when idle, which silently stops trading.
- **Exactly one instance.** Per-user bot state lives in memory
  (`botEngine.ts`, `scannerEngine.ts`). A second instance would run its own
  copy of every user's bot and place **duplicate live orders**.

---

## 1. Supabase

1. Create a project (choose a region near your Render region — Frankfurt/EU
   keeps latency low if Render is also in Frankfurt).
2. **Settings → Database → Connection string**, and pick the **Session pooler**.

   Supabase offers three connection modes and the choice matters here:

   | Mode | Use it? | Why |
   |---|---|---|
   | **Session pooler** | ✅ **Use this** | IPv4-compatible and behaves like a direct connection — supports prepared statements. |
   | Direct (`5432`) | ⚠️ Only with IPv4 add-on | Fine technically, but IPv6-only on new projects, which Render may not reach. |
   | Transaction pooler (`6543`) | ❌ Avoid | Built for serverless. Does **not** support prepared statements, which Drizzle and `node-postgres` rely on — causes intermittent "prepared statement already exists" errors under load. |

3. Keep that string for `DATABASE_URL` below. Replace `[YOUR-PASSWORD]` in the
   template with your actual database password.

## 2. Generate secrets

```bash
# CREDENTIALS_ENCRYPTION_KEY — must be exactly 64 hex chars (32 bytes)
openssl rand -hex 32
```

> **Back this value up somewhere safe.** It encrypts every user's broker
> credentials. If it is lost or changed, those credentials become permanently
> undecryptable and every user must reconnect their broker.

`SESSION_SECRET` is generated automatically by Render (`generateValue: true`).

## 3. Anthropic

Get an API key from console.anthropic.com and make sure the account has
billing/credit. Anthropic powers **all** AI features: Assistant, Signal
Analyst, Market Brain, daily briefs, chart insights, trade intelligence,
Performance Coach, and the AI trade modes.

(OpenAI is no longer used — the Assistant was migrated to Anthropic so the app
needs a single provider.)

## 4. Render

Either point Render at `render.yaml` (Blueprint) or create a Web Service
manually with:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm run build` |
| Start command | `pnpm --filter @workspace/api-server run start` |
| Health check path | `/api/healthz` |
| Instances | **1** |
| Plan | any **paid** tier |

Environment variables:

| Variable | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase pooled URI |
| `SESSION_SECRET` | auto-generated |
| `CREDENTIALS_ENCRYPTION_KEY` | your `openssl rand -hex 32` output |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | `https://api.anthropic.com` |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | your Anthropic key |

`PORT` is injected by Render — do not set it.

## 5. Create the database schema

The app does **not** create tables at boot. After the first successful deploy,
push the schema once from your machine:

```bash
DATABASE_URL='<supabase-pooled-uri>' pnpm --filter @workspace/db push
```

Against an empty database this creates all tables with no prompts. If drizzle
ever asks whether a table is "new" or a "rename", the safe answer is **new** —
see `.agents/memory/drizzle-push-quirk.md`.

Re-run this command after any future schema change.

## 6. First admin user

Sign up through the UI, then promote that account:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

Admins bypass every subscription limit, so use a **second, non-admin** account
when testing the paywall.

## 7. Domain

Add `tradebuzz.co.uk` under the service's **Settings → Custom Domains** and
follow Render's DNS instructions. Render provisions TLS automatically.

---

## Verification

1. `/api/healthz` returns `{"status":"ok"}`
2. The UI loads, and a client-side route (e.g. `/settings`) survives a refresh
   — proves the SPA fallback works
3. Sign up, log in — proves cookies and `SESSION_SECRET` work
4. Connect a broker — proves `CREDENTIALS_ENCRYPTION_KEY` works
5. Send an Assistant message — proves the Anthropic key works
6. Start the bot in **Dry Run** and confirm a cycle runs before going live

## Notes

- **Deploys restart the process**, which clears in-memory bot state. Running
  bots resume from persisted config on the next cycle, but a deploy mid-session
  is worth avoiding during market hours.
- **Scaling up is unsafe** until per-user bot state moves out of memory.
- Migrating off Replit removed its rollback/checkpoint behaviour; GitHub is now
  the only source of truth, so keep pushing after every change.
