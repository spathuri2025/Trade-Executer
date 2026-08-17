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
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @workspace/api-spec run codegen && pnpm --filter @workspace/api-server --filter @workspace/trading-bot run build` |
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
| `RESEND_API_KEY` | your Resend key — optional, see below |
| `EMAIL_FROM` | `TradeBuzz <noreply@mail.tradebuzz.co.uk>` |
| `APP_BASE_URL` | `https://www.tradebuzz.co.uk` |

`PORT` is injected by Render — do not set it.

### Password-reset email (optional)

`RESEND_API_KEY` + `EMAIL_FROM` are the only things "Forgot password?" needs.
Leave them unset and the whole app still works — the reset request is accepted,
no email goes out, and the server logs an error saying why. Users can't reset
their own password until both are set; you'd have to do it for them.

Set up: create a Resend account, add `mail.tradebuzz.co.uk` as a domain there,
add the three DNS records it gives you (DKIM TXT, SPF TXT, MX) at IONOS, then
create an API key. `EMAIL_FROM` must use the verified domain or Resend rejects
every send.

The verified domain is deliberately the `mail.` **subdomain**, not the root. Mail
records on `tradebuzz.co.uk` itself would sit alongside the website's A record
and any root-domain email, so a mistake there could take the site or existing
mail down. The subdomain is isolated.

`APP_BASE_URL` is what the reset link in the email points at. If unset the
server falls back to the request's own `Host`, which would put the raw
`*.onrender.com` hostname in the email — it works, but looks wrong to users.

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

- **`artifacts/mockup-sandbox` is excluded from the deploy build.** It's a
  design scratchpad the app never imports, and its vite config still requires
  the `PORT`/`BASE_PATH` variables Replit used to inject — so `pnpm run build`
  (which builds every package) fails outside Replit. Only `api-server` and
  `trading-bot` are built for production. If you ever need the sandbox to build
  elsewhere, give its vite config the same defaults `trading-bot`'s now has.

- **Deploys restart the process**, which clears in-memory engine state. Bots and
  scanners that were running are re-armed at boot from `bot_config.running` and
  `scanner_config.running`, staggered 20s and 60s apart respectively. A deploy is
  still worth avoiding during market hours: an in-flight cycle is lost, and
  there's a gap of up to one interval before trading resumes.

  (An earlier version of this note claimed bots "resume from persisted config on
  the next cycle". That was wrong — only the *config* was persisted, not whether
  the bot was running, so until Aug 2026 every deploy silently stopped every
  customer's bot and the UI still had to be checked by hand.)
- **Scaling up is unsafe** until per-user bot state moves out of memory.
- Migrating off Replit removed its rollback/checkpoint behaviour; GitHub is now
  the only source of truth, so keep pushing after every change.
