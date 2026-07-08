---
name: Admin Centre (customer/tenant management)
description: Role-based admin panel — customer list, suspend/delete, subscriptions, contracts
---

# Admin Centre

`role` (`"customer"|"admin"`, default `"customer"`) and `suspendedAt` (nullable
timestamp) live on `usersTable`. There is **no self-serve way to become
admin** — the first admin account is promoted with a direct DB update
(`UPDATE users SET role='admin' WHERE email='...'`). This is a deliberate
one-time operator action, not a gap.

**Authorization stack:** `requireAuth` (all routes) → `requireAdmin`
(`artifacts/api-server/src/middlewares/requireAdmin.ts`, mounted at the top of
`routes/admin.ts`) checks `req.user.role === "admin"`, 403 otherwise. Every
`/admin/*` route sits behind both.

**Suspension takes effect immediately, not just at next login.** Three
places enforce it:
1. `POST /auth/login` rejects a suspended account's login attempt directly (403).
2. `requireAuth` re-checks `suspendedAt` on *every* request — a suspension
   mid-session is not delayed until the session naturally expires.
3. `POST /admin/customers/:id/suspend` calls `stopBot(id)` +
   `evictCapitalStream(id)` synchronously — a running bot/live-stream does
   not keep going after suspension.

An admin can never suspend or delete their own account (`400`, checked
in `routes/admin.ts`) — there is no recovery path if the only admin locks
themselves out.

**No self-serve admin demotion/promotion either** — `routes/admin.ts` has
no endpoint for changing `role`; only `suspendedAt` is mutable via the API.

**Subscriptions are admin-authored, not Stripe-driven.** One row per user in
`subscriptions` (`plan`, `status`, `notes`, `renewsAt`), upserted by the
admin through `PUT /admin/customers/:id/subscription`. No payment processor
is wired up yet — this is real, useful data on its own (who's on what plan)
with a clear upgrade path: a future Stripe webhook would just start writing
to this same table.

**Contracts are base64 in Postgres, not object storage.** `contracts.fileData`
is a `text` column holding base64, capped at 10MB via `multer`
(`memoryStorage`). Adequate for infrequent admin-uploaded legal documents,
not designed for user-generated media at scale.

**Upload/download are NOT in the OpenAPI spec** — same exception already
established for SSE endpoints (see `.agents/memory/openapi-route-conventions.md`).
`POST /admin/customers/:id/contracts` takes `multipart/form-data` via
`multer`; the frontend posts a raw `FormData` via `fetch`, not a generated
Orval hook. `GET /admin/contracts/:contractId/download` is a plain link
(`<a href>` / `window.open`) — the browser sends cookies automatically on
same-origin navigation, no `fetch`/`credentials` needed. Every other admin
endpoint (customer list, suspend/unsuspend/delete, subscription CRUD,
contract list/delete) IS in the OpenAPI spec and uses generated hooks
normally.

**`peekBotRunning(userId)`** (`botEngine.ts`) is a pure `Map` lookup with no
side effects — used by the admin customer list so viewing `/admin` never
lazily creates in-memory bot state for a customer who has never started a
bot (unlike `getBotStatus`, which does create it on first access).

**Frontend gating is UX only, not the real boundary.** `layout.tsx`'s
`NavLinks` hides the "Admin Centre" link unless `user?.role === "admin"`,
and `pages/admin.tsx` redirects non-admins to `/` — but the actual
enforcement is server-side `requireAdmin`. Never assume the nav-link check
is sufficient security by itself.

**How to apply:** any new admin-only action goes in `routes/admin.ts`
behind the existing `requireAdmin` gate. Any action that changes a
customer's access level (suspend, future demote/ban) must be checked
against whether it needs to force-stop live engine state (`stopBot`,
`evictCapitalStream`) the same way suspend does — don't just flip a DB flag
and assume it takes effect.
