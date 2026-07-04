---
name: Orval codegen gotchas
description: Non-obvious naming collisions and rules when adding endpoints to the contract-first OpenAPI spec
---

# Orval codegen gotchas (contract-first repo)

**Path param + query params on the same endpoint collide.** If an operation has
BOTH a path parameter and query parameters, Orval emits two exports named
`<OpId>Params` (one for the path-param zod object in the generated api, one for
the query-params type in generated/types), producing TS2308 "already exported a
member named '<OpId>Params'". `typecheck:libs` fails during codegen.

**Why:** the zod client names the path-param object `<OpId>Params` and the
query-params type is also `<OpId>Params`; the api-zod barrel re-exports both.

**How to apply:** prefer making the identifier a **query** param instead of a
path param when the operation also needs query params (e.g. `/candles?epic=...`
not `/candles/{epic}`). Endpoints with only a path param (no query) are fine.

**Also:** when using a generated query hook with `enabled`, you must pass an
explicit `queryKey` (via the generated `get<Op>QueryKey(...)`) or TS complains
`queryKey` is missing. See existing pages for the pattern.
