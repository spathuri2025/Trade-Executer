import type { BriefHighlight } from "@workspace/db";
import { buildTradingContext } from "./assistantContext";
import { getMarketNews } from "./newsService";
import { asString, generateClaudeJson, oneOf } from "./aiJson";

export const ASSISTANT_BRIEF_DISCLAIMER =
  "Trading involves substantial risk and nothing here is financial advice.";

export interface GeneratedAssistantBrief {
  message: string;
  highlights: BriefHighlight[];
  disclaimer: string;
}

const HIGHLIGHT_TYPES = ["risk", "opportunity", "alert"] as const;

/**
 * Generates a short, proactive good-morning briefing for the Assistant, grounded
 * in the user's live TradeBuzz state and today's news headlines.
 */
export async function generateAssistantDailyBrief(): Promise<GeneratedAssistantBrief> {
  const context = await buildTradingContext();
  const news = await getMarketNews(10);
  const headlines = news
    .slice(0, 8)
    .map((n, i) => `${i + 1}. [${n.impactLabel}] ${n.title}`)
    .join("\n");

  const prompt = `You are the TradeBuzz assistant giving the user a SHORT, friendly good-morning briefing. Use very plain English, no jargon. Base it on the user's live account/watchlist state and today's headlines below. Point out anything on their watchlist worth a look, any risk to be careful about, and keep it to a few short sentences. Do NOT give guaranteed buy/sell signals.

## Today's headlines
${headlines || "(no fresh news available)"}

## User's live state
${context}

Respond with ONLY a valid JSON object (no markdown, no code fences) of the exact shape:
{
  "message": string,   // 2-4 short sentences, plain language, friendly, references the user's real data
  "highlights": [ { "type": "risk"|"opportunity"|"alert", "text": string } ]  // 1-3 short bullet highlights
}`;

  const parsed = await generateClaudeJson(prompt, { maxTokens: 1024 });

  const rawHighlights = Array.isArray(parsed["highlights"]) ? parsed["highlights"] : [];
  const highlights: BriefHighlight[] = rawHighlights
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((o) => ({
      type: oneOf(o["type"], HIGHLIGHT_TYPES, "alert"),
      text: asString(o["text"]),
    }))
    .filter((h) => h.text)
    .slice(0, 3);

  return {
    message: asString(parsed["message"]),
    highlights,
    disclaimer: ASSISTANT_BRIEF_DISCLAIMER,
  };
}
