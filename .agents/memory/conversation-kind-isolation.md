---
name: Conversation kind isolation
description: Why every conversation-ID route must filter by kind in the shared conversations/messages tables
---

# Conversation kind isolation

The Assistant (`/assistant`, OpenAI) and Signal Analyst (`/signal-analyst`, Claude) chats
share the same `conversations` and `messages` tables, discriminated only by the
`conversations.kind` column (`'assistant'` vs `'signal_analyst'`).

**Rule:** EVERY conversation-ID route in BOTH routers must filter by `(id AND kind)`,
not just `id` — that includes get, delete, list-messages, and send-message, not only
the list/create endpoints.

**Why:** Scoping only list/create is not enough. If get/delete/send/list-messages match
by `id` alone, one chat can read, write, or delete the other chat's conversations and
messages by guessing an ID. This is the only isolation boundary between the two chat
*features* — it does not isolate between different *users*. An architect review caught
this exact gap after the initial implementation only scoped list/create.

**How to apply:** When adding any new chat "kind" sharing these tables, or any new
ID-based route, use `and(eq(conversations.id, id), eq(conversations.kind, KIND), eq(conversations.userId, req.user!.id))`.
For message routes, first verify the parent conversation exists with the right kind AND
owner (404 if not), then operate on messages by `conversationId` (messages have no
`userId` of their own — ownership is inherited transitively through the parent
conversation, which is why every message route re-checks the parent first).

**Update:** `conversations` now has a `userId` column and every one of the 5 ID-touching
routes in both `assistant.ts` and `signalAnalyst.ts` (list, get, delete, list-messages,
send-message) filters by `(id AND kind AND userId)` — this was the last per-user gap left
after the multi-tenant broker round (see `.agents/memory/multi-tenant-broker.md`) and is
now closed. `messages` itself intentionally has no `userId` column — it's scoped
transitively via `conversations.id`.
