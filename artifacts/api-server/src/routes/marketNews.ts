import { Router, type IRouter } from "express";
import { db, marketNewsTable, aiMarketAnalysisTable, type MarketNews } from "@workspace/db";
import { desc, inArray } from "drizzle-orm";
import { getMarketNews } from "../lib/newsService";
import { analyseNews, NEWS_DISCLAIMER } from "../lib/newsAnalysisService";

const router: IRouter = Router();

/** Shown only when both the live RSS feed and the stored table are empty. */
const MOCK_NEWS = [
  {
    id: -1,
    title: "Fed holds rates steady, signals data-dependent path ahead",
    url: "https://example.com/mock/fed-holds",
    source: "TradeBuzz (sample)",
    publishedAt: new Date().toISOString(),
    impactScore: 3,
    impactLabel: "HIGH" as const,
    createdAt: new Date().toISOString(),
  },
  {
    id: -2,
    title: "Oil edges higher as OPEC+ weighs supply outlook",
    url: "https://example.com/mock/oil-opec",
    source: "TradeBuzz (sample)",
    publishedAt: new Date().toISOString(),
    impactScore: 2,
    impactLabel: "MEDIUM" as const,
    createdAt: new Date().toISOString(),
  },
  {
    id: -3,
    title: "Gold steadies near record as traders eye inflation data",
    url: "https://example.com/mock/gold-steady",
    source: "TradeBuzz (sample)",
    publishedAt: new Date().toISOString(),
    impactScore: 2,
    impactLabel: "MEDIUM" as const,
    createdAt: new Date().toISOString(),
  },
];

function toDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function serialize(n: MarketNews) {
  return {
    id: n.id,
    title: n.title,
    url: n.url,
    source: n.source,
    publishedAt: n.publishedAt ? n.publishedAt.toISOString() : null,
    impactScore: n.impactScore,
    impactLabel: n.impactLabel,
    createdAt: n.createdAt.toISOString(),
  };
}

router.get("/market-news", async (req, res): Promise<void> => {
  try {
    const limit = req.query["limit"] ? Math.min(Number(req.query["limit"]), 50) : 30;

    // Pull the live RSS feed and persist any new items so the page has a stable,
    // growing store (and so mock data is only ever a last resort).
    const rss = await getMarketNews(30);
    if (rss.length > 0) {
      const urls = rss.map((r) => r.url);
      const existing = await db
        .select({ url: marketNewsTable.url })
        .from(marketNewsTable)
        .where(inArray(marketNewsTable.url, urls));
      const seen = new Set(existing.map((e) => e.url));
      const toInsert = rss
        .filter((r) => !seen.has(r.url))
        .map((r) => ({
          title: r.title,
          url: r.url,
          source: r.source,
          publishedAt: toDate(r.publishedAt),
          impactScore: r.impactScore,
          impactLabel: r.impactLabel,
        }));
      if (toInsert.length > 0) {
        await db.insert(marketNewsTable).values(toInsert);
      }
    }

    const rows = await db
      .select()
      .from(marketNewsTable)
      .orderBy(desc(marketNewsTable.createdAt))
      .limit(Number.isFinite(limit) ? limit : 30);

    if (rows.length === 0) {
      res.json({ items: MOCK_NEWS, mock: true });
      return;
    }
    res.json({ items: rows.map(serialize), mock: false });
  } catch (err) {
    req.log.error({ err }, "Failed to list market news");
    // Never hard-fail the page — fall back to mock data.
    res.json({ items: MOCK_NEWS, mock: true });
  }
});

router.post("/market-news/analyse", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const headline = typeof body["headline"] === "string" ? body["headline"].trim() : "";
  if (!headline) {
    res.status(400).json({ error: "headline is required" });
    return;
  }
  const source = typeof body["source"] === "string" ? body["source"] : undefined;
  const articleText = typeof body["articleText"] === "string" ? body["articleText"] : undefined;
  const timestamp = typeof body["timestamp"] === "string" ? body["timestamp"] : undefined;
  const articleUrl = typeof body["articleUrl"] === "string" ? body["articleUrl"] : undefined;

  try {
    const analysis = await analyseNews({ headline, source, articleText, timestamp });

    const [saved] = await db
      .insert(aiMarketAnalysisTable)
      .values({
        headline,
        source: source ?? null,
        articleUrl: articleUrl ?? null,
        affectedAssets: analysis.affectedAssets,
        sentiment: analysis.sentiment,
        impactLevel: analysis.impactLevel,
        summary: analysis.summary,
        whyItMatters: analysis.whyItMatters,
        possibleReaction: analysis.possibleReaction,
        riskWarning: analysis.riskWarning,
      })
      .returning();

    res.json({ id: saved?.id ?? null, ...analysis, disclaimer: NEWS_DISCLAIMER });
  } catch (err) {
    req.log.error({ err }, "Failed to analyse news item");
    res.status(502).json({ error: "Failed to analyse this news item" });
  }
});

export default router;
