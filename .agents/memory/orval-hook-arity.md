---
name: Orval React Query hook arity
description: Paramless generated hooks take (options) only; regenerating can break call sites
---

Orval-generated React Query query hooks take the request/query `options` object as their FIRST argument for endpoints that have no path/query params (e.g. `useGetBotStatus({ query: {...} })`). Endpoints that DO take query params get `(params, options)`.

**Why:** when porting a project into this repo and running `pnpm --filter @workspace/api-spec run codegen`, the regenerated hooks follow this repo's orval config, which can differ from how the source project's call sites were written (they passed `(undefined, options)` for paramless hooks → TS2554 "Expected 0-1 arguments, but got 2").

**How to apply:** after regenerating the client, if you see TS2554 on hook calls, drop the leading `undefined,` for paramless endpoints only. Leave `(undefined, options)` intact for hooks whose endpoint actually accepts params — there it correctly means "no params, here are options".
