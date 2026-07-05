---
name: TradeBuzz OpenAPI + route conventions
description: How this contract-first repo wires new API endpoints and why routes hand-validate inputs
---

Contract-first: define the path + schemas in `lib/api-spec/openapi.yaml`, then run `pnpm --filter @workspace/api-spec run codegen` (emits React Query hooks + Zod into `@workspace/api-client-react`). Verify with `pnpm run typecheck`, NOT `build` (build needs workflow-provided PORT/BASE_PATH).

**Conventions:**
- Nullable fields use `type: ["string","null"]` (or `oneOf: [$ref, {type: "null"}]` for nullable object refs). This is the existing style — don't introduce `nullable: true`.
- Route handlers validate request inputs **manually** (mirror `routes/news.ts`) instead of importing generated Zod param/body schemas. This deliberately decouples handlers from Orval's generated type names, which change with `operationId`. The one exception is `signals.ts`, which imports `ListSignalsQueryParams`.
- `operationId` drives hook names (`listMarketNews` → `useListMarketNews`, `getGetXQueryKey`). Keep them stable.
- SSE endpoints (assistant chat, signal analyst) are **not** in the spec — Orval can't codegen SSE; they're consumed via raw `fetch`/`ReadableStream` or `EventSource`.

**Why:** codegen renames ripple through every importer; hand-validating inputs keeps route logic stable across spec churn. **Gotcha:** a path param + query params on the same path made Orval emit two colliding param types — prefer query params (see the `/candles` note in replit.md).
