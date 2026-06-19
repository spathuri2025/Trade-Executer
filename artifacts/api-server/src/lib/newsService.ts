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
      // Fed / central bank decisions
      "federal reserve", "fed rate", "fomc", "rate hike", "rate cut",
      "interest rate decision", "jerome powell", "powell speech",
      "quantitative tightening", "quantitative easing",
      // Key US data releases
      "nonfarm payrolls", "jobs report", "cpi report", "pce data",
      "inflation data", "core inflation", "gdp report",
    ],
  },
  {
    score: 2,
    terms: [
      // US macro
      "federal reserve", "us inflation", "us economy", "us recession",
      "us gdp", "us jobs", "unemployment rate", "retail sales",
      "consumer confidence", "treasury yield", "10-year yield",
      "us debt ceiling", "government shutdown",
      // US markets
      "s&p 500", "s&p500", "nasdaq", "dow jones", "wall street",
      "stock market crash", "market sell-off", "market rally",
      // Commodities & energy
      "opec", "oil production", "oil price surge", "gold rally",
      // Corporate
      "earnings beat", "earnings miss", "profit warning", "guidance cut",
      "layoffs", "mass layoffs", "bankruptcy",
      // Geopolitical with US impact
      "trade war", "us tariff", "china tariff", "us sanctions",
    ],
  },
  {
    score: 1,
    terms: [
      // Broader US financial context
      "interest rates", "inflation", "federal budget", "us dollar",
      "dollar index", "treasury", "bond market", "yield curve",
      "stock market", "wall street", "s&p", "nasdaq",
      "earnings season", "quarterly results", "quarterly earnings",
      "ipo", "merger", "acquisition", "buyback",
      // Energy / commodities
      "oil price", "crude oil", "natural gas price", "gold price",
      "commodity prices",
      // Broad macro
      "recession", "economic growth", "gdp growth", "gdp contraction",
      "central bank", "monetary policy", "fiscal policy",
      // Geopolitical
      "iran", "russia", "china trade", "sanctions", "tariff", "war",
      "geopolitical",
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

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x2018;/g, "\u2018")
    .replace(/&#x2019;/g, "\u2019")
    .replace(/&#x201C;/g, "\u201C")
    .replace(/&#x201D;/g, "\u201D")
    .replace(/&#x2013;/g, "\u2013")
    .replace(/&#x2014;/g, "\u2014")
    .replace(/&#x2026;/g, "\u2026")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractTag(xml: string, tag: string): string {
  const cdataMatch = xml.match(new RegExp(`<${tag}><\\!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`, "s"));
  if (cdataMatch) return decodeHtmlEntities(cdataMatch[1].trim());
  const plain = xml.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`, "s"));
  return plain ? decodeHtmlEntities(plain[1].trim()) : "";
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
  // US-focused sources first
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", name: "MarketWatch" },
  { url: "https://feeds.npr.org/1006/rss.xml", name: "NPR Business" },
  // Broad financial coverage (includes US heavily)
  { url: "https://www.investing.com/rss/news.rss", name: "Investing.com" },
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
