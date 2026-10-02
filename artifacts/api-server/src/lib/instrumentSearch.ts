import type { CapitalMarketSummary } from "./capitalcom";

/**
 * Finding an instrument by name instead of guessing its identifier.
 *
 * The watchlist field is labelled "Ticker Symbol" and shows AAPL as its
 * example, but what the engine actually sends Capital.com is an *epic* —
 * their internal id. For shares the two coincide, which is why every
 * instrument added so far worked and why the first commodity did not: crude
 * oil's epic is OIL_CRUDE, and nothing in the product would ever have told
 * anyone that. An instrument added with a wrong epic looks perfectly fine in
 * the list and simply never produces a signal, which is the worst way for this
 * to fail.
 */

export interface InstrumentMatch {
  epic: string;
  name: string;
  instrumentType: string;
}

/**
 * Ranked matches for what someone typed, best first.
 *
 * Ranking matters more than it looks: searching "oil" against Capital.com's
 * several thousand epics returns dozens of rows, and the one wanted is almost
 * always the plain spot market rather than a dated future or a themed basket.
 * An exact epic match wins outright, then a name that starts with the query,
 * then anything containing it — so "GOLD" finds Gold Spot rather than
 * "Goldman Sachs".
 */
export function searchInstruments(
  universe: CapitalMarketSummary[],
  query: string,
  limit = 20
): InstrumentMatch[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const scored: Array<{ m: InstrumentMatch; score: number }> = [];
  for (const row of universe) {
    const epic = (row.epic ?? "").trim();
    const name = (row.instrumentName ?? "").trim();
    if (!epic) continue;

    const epicLower = epic.toLowerCase();
    const nameLower = name.toLowerCase();

    let score: number;
    if (epicLower === q) score = 0;
    else if (nameLower === q) score = 1;
    else if (nameLower.startsWith(q)) score = 2;
    else if (epicLower.startsWith(q)) score = 3;
    else if (nameLower.includes(q)) score = 4;
    else if (epicLower.includes(q)) score = 5;
    else continue;

    scored.push({
      m: { epic, name: name || epic, instrumentType: row.instrumentType ?? "UNKNOWN" },
      score,
    });
  }

  return scored
    // Shorter names first within a tier: "Gold Spot" before
    // "Gold Spot Mini Jun 26", which is what someone searching "gold" means.
    .sort((a, b) => a.score - b.score || a.m.name.length - b.m.name.length || a.m.epic.localeCompare(b.m.epic))
    .slice(0, limit)
    .map((s) => s.m);
}
