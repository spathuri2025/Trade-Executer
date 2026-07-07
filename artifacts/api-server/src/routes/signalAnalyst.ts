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
import { buildSignalAnalystSystemPrompt } from "../lib/signalAnalystContext";

const router: IRouter = Router();

const KIND = "signal_analyst";

const DISCLAIMER_LINE =
  "_Reminder: This is analytical assistance only, not regulated financial advice. Trading involves substantial risk._";

/**
 * Guarantees every analyst reply carries a risk / not-financial-advice
 * disclaimer. If the model already included one, the text is returned
 * unchanged; otherwise a standard reminder is appended.
 */
function ensureDisclaimer(text: string): string {
  const lower = text.toLowerCase();
  const hasDisclaimer =
    lower.includes("not financial advice") ||
    lower.includes("financial advice") ||
    lower.includes("not regulated") ||
    (lower.includes("risk") && lower.includes("advice"));
  if (hasDisclaimer) return text;
  const sep = text.trim().length > 0 ? "\n\n" : "";
  return `${text}${sep}${DISCLAIMER_LINE}`;
}

router.get("/signal-analyst/conversations", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.kind, KIND))
    .orderBy(desc(conversations.createdAt));
  res.json(ListConversationsResponse.parse(rows));
});

router.post("/signal-analyst/conversations", async (req, res): Promise<void> => {
  const parsed = CreateConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(conversations)
    .values({ title: parsed.data.title, kind: KIND })
    .returning();
  res.status(201).json(ListConversationsResponseItem.parse(row));
});

router.get("/signal-analyst/conversations/:id", async (req, res): Promise<void> => {
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, params.data.id), eq(conversations.kind, KIND)));
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

router.delete("/signal-analyst/conversations/:id", async (req, res): Promise<void> => {
  const params = DeleteConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(conversations)
    .where(and(eq(conversations.id, params.data.id), eq(conversations.kind, KIND)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/signal-analyst/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, params.data.id), eq(conversations.kind, KIND)));
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

router.post("/signal-analyst/conversations/:id/messages", async (req, res): Promise<void> => {
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
    .where(and(eq(conversations.id, conversationId), eq(conversations.kind, KIND)));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
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

  const systemPrompt = await buildSignalAnalystSystemPrompt(req.user!.id);

  // Anthropic takes the system prompt as a top-level field; messages must be
  // user/assistant turns only.
  const chatMessages = history.map((m) => ({
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
      req.log.error({ err, conversationId }, "Signal Analyst streaming error");
      res.write(
        `data: ${JSON.stringify({ error: "The Signal Analyst encountered an error. Please try again." })}\n\n`,
      );
      res.end();
    }
    req.off("close", onClose);
    return;
  }

  req.off("close", onClose);

  // Enforce the risk / not-financial-advice disclaimer on every reply, even if
  // the model omits it. This is a hard product requirement.
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
