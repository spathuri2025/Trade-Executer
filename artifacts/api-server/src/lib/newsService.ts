import { logger } from "./logger";

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  impactScore: number;
  impactLabel: "HIGH" | "MEDIUM";
}

// Tiered keyword scoring — only articles that score >= 1 are shown
const IMPACT_KEYWORDS: Array<{ terms: string[]; score: number }> = [
  {
    score: 3,
    terms: [
      "federal reserve", "fed rate", "interest rate decision", "rate hike", "rate cut",
      "ecb rate", "bank of england rate", "boe rate", "central bank rate",
      "quantitative tightening", "quantitative easing", "fomc",
      "nonfarm payrolls", "jobs report", "cpi data", "inflation data", "pce",
    ],
  },
  {
    score: 2,
    terms: [
      "inflation", "gdp growth", "gdp contraction", "recession", "unemployment rate",
      "retail sales", "opec", "oil production cut", "oil embargo",
      "earnings beat", "earnings miss", "profit warning", "guidance cut",
      "debt ceiling", "government shutdown", "default", "bailout", "credit rating",
      "trade war", "tariff", "sanctions",
    ],
  },
  {
    score: 1,
    terms: [
      "federal reserve", "interest rates", "central bank", "bank of england",
      "european central bank", "yields", "bond market", "stock market",
      "market rally", "market sell-off", "market crash", "market slump",
      "oil price", "gold price", "dollar index", "currency crisis",
      "ipo", "merger", "acquisition", "earnings", "quarterly results",
      "geopolitical", "war", "military", "iran", "russia", "china trade",
    ],
  },
];

function scoreArticle(title: string): number {
  const lower = title.toLowerCase();
  let score = 0;
  for (const tier of IMPACT_KEYWORDS) {
    for (const term of tier.terms) {
      if (lower.includes(term)) {
        score += tier.score;
        break; // one hit per tier is enough
      }
    }
  }
  return score;
}

function extractTag(xml: string, tag: string): string {
  const cdataMatch = xml.match(new RegExp(`<${tag}><\\!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`, "s"));
  if (cdataMatch) return cdataMatch[1].trim();
  const plain = xml.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`, "s"));
  return plain ? plain[1].trim() : "";
}

function parseRss(xml: string, source: string): NewsItem[] {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  const results: NewsItem[] = [];

  for (const item of items) {
    const title = extractTag(item, "title");
    const link = extractTag(item, "link") || extractTag(item, "guid");
    const pubDate = extractTag(item, "pubDate");
    if (!title || !link) continue;

    const score = scoreArticle(title);
    if (score === 0) continue;

    results.push({
      title,
      url: link,
      source,
      publishedAt: pubDate,
      impactScore: score,
      impactLabel: score >= 2 ? "HIGH" : "MEDIUM",
    });
  }

  return results;
}

interface CacheEntry {
  items: NewsItem[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
let cache: CacheEntry | null = null;

const RSS_SOURCES: Array<{ url: string; name: string }> = [
  { url: "https://www.investing.com/rss/news.rss", name: "Investing.com" },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "BBC Business" },
];

async function fetchFeed(url: string, source: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "TradeBuzz/1.0 (+https://tradebuzz.app)" },
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "RSS feed returned non-OK status");
      return [];
    }
    const xml = await res.text();
    return parseRss(xml, source);
  } catch (err) {
    logger.warn({ url, err }, "Failed to fetch RSS feed");
    return [];
  }
}

export async function getMarketNews(maxItems = 20): Promise<NewsItem[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.items.slice(0, maxItems);
  }

  const results = await Promise.all(
    RSS_SOURCES.map((s) => fetchFeed(s.url, s.name))
  );

  const all = results
    .flat()
    .sort((a, b) => {
      // Sort by impact score first, then by date
      if (b.impactScore !== a.impactScore) return b.impactScore - a.impactScore;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

  // Deduplicate by similar titles
  const seen = new Set<string>();
  const deduped = all.filter((item) => {
    const key = item.title.toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  cache = { items: deduped, fetchedAt: Date.now() };
  logger.info({ total: deduped.length }, "News cache refreshed");
  return deduped.slice(0, maxItems);
}
