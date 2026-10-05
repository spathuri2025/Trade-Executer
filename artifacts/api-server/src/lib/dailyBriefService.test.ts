import { describe, it, expect, vi } from "vitest";

// The Anthropic client throws at import when its base URL is unset, which it is
// in tests. The spy also lets us assert what was actually sent.
const create = vi.fn();
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: { messages: { create } } }));

const { briefPrompt, generateDailyBrief } = await import("./dailyBriefService");

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

/** A well-formed reply, so the function reaches the end and we can inspect the call. */
const reply = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        markets: [
          { name: "Crude Oil WTI", bias: "Bullish", support: "60", resistance: "65", summary: "x" },
          { name: "Gold", bias: "Neutral", support: "4000", resistance: "4200", summary: "x" },
          { name: "S&P 500", bias: "Bearish", support: "7500", resistance: "7800", summary: "x" },
          { name: "Bitcoin", bias: "Neutral", support: "90000", resistance: "99000", summary: "x" },
        ],
      }),
    },
  ],
};

/**
 * Until 5 Oct 2026 this prompt went out with no tools, so every level and every
 * "news event" in the Market News page came from training data and was shown as
 * today's market — including headlines about an S&P fall that never happened.
 */
describe("briefPrompt", () => {
  it("requires searching before anything is written", () => {
    expect(briefPrompt()).toMatch(/use web search to find today's actual/i);
  });

  it("forbids numbers and events recalled from memory", () => {
    const p = briefPrompt();
    expect(p).toMatch(/must come from something you found just now/i);
    expect(p).toMatch(/never from memory/i);
  });

  it("tells it to admit a gap rather than estimate one", () => {
    expect(briefPrompt()).toMatch(/say so for that market instead of estimating/i);
  });

  it("still carries the risk disclaimer the product requires", () => {
    expect(briefPrompt()).toMatch(/not financial advice/i);
  });

  it("still asks for all four markets", () => {
    const p = briefPrompt();
    for (const m of ["Crude Oil WTI", "Gold", "S&P 500", "Bitcoin"]) expect(p).toContain(m);
  });
});

describe("generateDailyBrief", () => {
  it("actually sends the web search tool, not just a prompt that says to search", async () => {
    // A prompt that orders a search, sent without the tool, is the worst of
    // both: the model is told its memory is out of date and then has no way to
    // replace it. Mutation testing found this gap — every prompt assertion
    // passed with the tool deleted from the call.
    create.mockReset();
    create.mockResolvedValue(reply);

    await generateDailyBrief(log);

    expect(create).toHaveBeenCalledTimes(1);
    const sent = create.mock.calls[0]![0] as { tools?: Array<{ type: string; name: string }> };
    expect(sent.tools).toEqual([
      expect.objectContaining({ type: "web_search_20250305", name: "web_search" }),
    ]);
  });

  it("does not fall back to a search-free call when the tool is refused", async () => {
    // Falling back would produce a brief of invented levels that looks
    // identical to a real one. Better to fail and leave the last real brief up.
    create.mockReset();
    create.mockRejectedValue(new Error("tool not supported"));

    await expect(generateDailyBrief(log)).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
