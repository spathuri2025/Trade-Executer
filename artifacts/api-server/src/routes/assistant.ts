import { Router, type IRouter } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  CreateConversationBody,
  GetConversationParams,
  DeleteConversationParams,
  ListMessagesParams,
  SendMessageParams,
  SendMessageBody,
  ListConversationsResponse,
  ListConversationsResponseItem,
  GetConversationResponse,
  ListMessagesResponse,
} from "@workspace/api-zod";
import { buildSystemPrompt } from "../lib/assistantContext";
import { consumeAiQuota, aiQuotaExceededBody } from "../lib/planService";

const router: IRouter = Router();

/** Most recent messages replayed to the model per reply — see usage below. */
const MAX_HISTORY_MESSAGES = 20;

const DISCLAIMER_LINE =
  "_Reminder: Trading involves substantial risk and nothing here constitutes financial advice._";

/**
 * Guarantees every assistant reply carries a risk / not-financial-advice
 * disclaimer. If the model already included one, the text is returned
 * unchanged; otherwise a standard reminder is appended.
 */
function ensureDisclaimer(text: string): string {
  const lower = text.toLowerCase();
  const hasDisclaimer =
    lower.includes("not financial advice") ||
    lower.includes("financial advice") ||
    (lower.includes("risk") && lower.includes("advice"));
  if (hasDisclaimer) return text;
  const sep = text.trim().length > 0 ? "\n\n" : "";
  return `${text}${sep}${DISCLAIMER_LINE}`;
}

router.get("/assistant/conversations", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.kind, "assistant"), eq(conversations.userId, req.user!.id)))
    .orderBy(desc(conversations.createdAt));
  res.json(ListConversationsResponse.parse(rows));
});

router.post("/assistant/conversations", async (req, res): Promise<void> => {
  const parsed = CreateConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(conversations)
    .values({ title: parsed.data.title, kind: "assistant", userId: req.user!.id })
    .returning();
  res.status(201).json(ListConversationsResponseItem.parse(row));
});

router.get("/assistant/conversations/:id", async (req, res): Promise<void> => {
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, params.data.id),
        eq(conversations.kind, "assistant"),
        eq(conversations.userId, req.user!.id),
      ),
    );
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(asc(messages.createdAt));
  res.json(GetConversationResponse.parse({ ...conversation, messages: msgs }));
});

router.delete("/assistant/conversations/:id", async (req, res): Promise<void> => {
  const params = DeleteConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, params.data.id),
        eq(conversations.kind, "assistant"),
        eq(conversations.userId, req.user!.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/assistant/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, params.data.id),
        eq(conversations.kind, "assistant"),
        eq(conversations.userId, req.user!.id),
      ),
    );
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(asc(messages.createdAt));
  res.json(ListMessagesResponse.parse(msgs));
});

router.post("/assistant/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = SendMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const conversationId = params.data.id;
  const userContent = parsed.data.content;
  if (typeof userContent !== "string" || userContent.trim().length === 0) {
    res.status(400).json({ error: "Message content is required" });
    return;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.kind, "assistant"),
        eq(conversations.userId, req.user!.id),
      ),
    );
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Consume the daily AI allowance BEFORE persisting the user's message, so a
  // rejected request doesn't leave an orphaned message with no reply — and
  // before any streaming headers go out, since we still need to send JSON.
  const quota = await consumeAiQuota(req.user!.id);
  if (!quota.allowed) {
    res.status(402).json(aiQuotaExceededBody(quota));
    return;
  }

  // Persist the user message before streaming the reply.
  await db.insert(messages).values({
    conversationId,
    role: "user",
    content: userContent,
  });

  // Load conversation history (includes the message we just inserted).
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  const systemPrompt = await buildSystemPrompt(req.user!.id);

  // Only the most recent turns are replayed to the model — see the matching
  // comment in signalAnalyst.ts for why (a fresh account snapshot competing
  // against old, now-outdated figures from earlier in a long-lived thread).
  const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);

  // Anthropic takes the system prompt as a top-level field; messages must be
  // user/assistant turns only.
  const chatMessages = recentHistory.map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";
  let clientGone = false;

  // Abort the upstream Claude stream if the client disconnects, to avoid
  // spending tokens on a response nobody is reading.
  const ac = new AbortController();
  const onClose = () => {
    clientGone = true;
    ac.abort();
  };
  req.on("close", onClose);

  try {
    const stream = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: systemPrompt,
        messages: chatMessages,
        stream: true,
      },
      { signal: ac.signal },
    );

    for await (const event of stream) {
      if (clientGone) break;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const content = event.delta.text;
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
    }
  } catch (err) {
    if (!clientGone) {
      req.log.error({ err, conversationId }, "Assistant streaming error");
      res.write(
        `data: ${JSON.stringify({ error: "The assistant encountered an error. Please try again." })}\n\n`,
      );
      res.end();
    }
    req.off("close", onClose);
    return;
  }

  req.off("close", onClose);

  // Enforce the risk / not-financial-advice disclaimer on every reply, even
  // if the model omits it. This is a hard product requirement.
  const finalResponse = ensureDisclaimer(fullResponse);
  const appended = finalResponse !== fullResponse;

  if (finalResponse.trim().length > 0) {
    await db.insert(messages).values({
      conversationId,
      role: "assistant",
      content: finalResponse,
    });
  }

  if (!clientGone) {
    if (appended) {
      const tail = finalResponse.slice(fullResponse.length);
      res.write(`data: ${JSON.stringify({ content: tail })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

export default router;
