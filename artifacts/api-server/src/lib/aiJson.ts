import { anthropic } from "@workspace/integrations-anthropic-ai";

/**
 * Shared helpers for the Claude-backed structured-JSON services (market brain,
 * news analysis, chart insight, performance coach, assistant daily brief). These
 * mirror the recovery logic first used in `dailyBriefService.ts` so every service
 * parses the model's output defensively and never trusts free-form prose.
 */

export function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value);
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const s = asString(value).toLowerCase();
  const hit = allowed.find((a) => a.toLowerCase() === s);
  return hit ?? fallback;
}

/** Parse a JSON object out of the model's text, recovering from prose/code fences. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Claude response did not contain valid JSON");
  }
}

/** Call Claude with a single user prompt and return the parsed JSON object. */
export async function generateClaudeJson(
  prompt: string,
  opts: { maxTokens?: number; model?: string } = {},
): Promise<Record<string, unknown>> {
  const message = await anthropic.messages.create({
    model: opts.model ?? "claude-sonnet-4-6",
    max_tokens: opts.maxTokens ?? 4096,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  if (!text) throw new Error("Claude returned an empty response");
  return extractJson(text) as Record<string, unknown>;
}
