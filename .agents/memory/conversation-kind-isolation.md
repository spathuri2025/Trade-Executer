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
messages by guessing an ID. The app currently has no auth, so this is the only isolation
boundary between the two features. An architect review caught this exact gap after the
initial implementation only scoped list/create.

**How to apply:** When adding any new chat "kind" sharing these tables, or any new
ID-based route, use `and(eq(conversations.id, id), eq(conversations.kind, KIND))`. For
message routes, first verify the parent conversation exists with the right kind (404 if
not), then operate on messages by `conversationId`.
