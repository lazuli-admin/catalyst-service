// Proactive prospecting: search Google News for future-looking catalysts, gate by credibility, store survivors.
import type { Store } from "../db.js";
import type { RawItem } from "../types.js";
import type { ExtractedCatalyst } from "./extract.js";
import { catalystDedupeKey } from "./extract.js";
import { acceptCatalyst, sourceTier } from "./credibility.js";
import { googleNewsAdapter } from "../sources/google-news.js";
import { errorMessage } from "../util.js";

export const DEFAULT_WATCHLIST = ["AAPL", "TSLA", "MSFT"];

export const DEFAULT_THEMES = [
  "AI data center",
  "semiconductor export controls",
  "hyperscaler capex",
  "FDA approval",
  "antitrust",
  "tariffs",
];

const TICKER_ACTIONS = '(expected OR scheduled OR deadline OR "on track" OR approval OR ruling OR "to close" OR launch OR "investor day")';
const THEME_ACTIONS = '(deadline OR "takes effect" OR "expected to" OR vote OR ruling OR approval)';

export function prospectQueries(watchlist: string[], themes: string[]): string[] {
  return [
    ...watchlist.map((t) => `${t} ${TICKER_ACTIONS} when:7d`),
    ...themes.map((theme) => `${theme} ${THEME_ACTIONS} when:7d`),
  ];
}

export interface ProspectDeps {
  store: Pick<Store, "upsertCatalyst">;
  extractor: { extract(item: { title: string; summary?: string; url?: string | null; publishedAt?: string | null }): Promise<ExtractedCatalyst[]> };
  fetch?: typeof fetch;
  userAgent?: string;
  log?: (msg: string) => void;
  now?: () => Date;
}

export async function runProspect(deps: ProspectDeps, opts: { watchlist: string[]; themes: string[]; maxItems: number; perQuery: number }): Promise<{ queries: number; items: number; stored: number }> {
  const { store, extractor, log, now } = deps;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const userAgent = deps.userAgent ?? "catalyst-service prospect";
  const today = (now?.() ?? new Date()).toISOString().slice(0, 10);
  const queries = prospectQueries(opts.watchlist, opts.themes);

  const allItems: RawItem[] = [];
  for (const query of queries) {
    try {
      const items = await googleNewsAdapter.fetch({ query, language: "en-US", country: "US" }, { fetch: fetchImpl, userAgent });
      allItems.push(...items.slice(0, opts.perQuery));
    } catch (err) {
      log?.(`prospect: query "${query}" failed: ${errorMessage(err)}`);
    }
  }

  const seen = new Set<string>();
  const unique = allItems.filter((i) => (seen.has(i.title) ? false : seen.add(i.title))).slice(0, opts.maxItems);

  const queue = [...unique];
  let stored = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const tier = sourceTier({ url: item.url, title: item.title });
          if (tier === 3) continue; // unverified source: skip the LLM call entirely
          const catalysts = await extractor.extract({ title: item.title, summary: item.summary, url: item.url, publishedAt: item.publishedAt });
          for (const c of catalysts) {
            const decision = acceptCatalyst(c, tier, today);
            if (!decision) continue;
            await store.upsertCatalyst({ ...c, status: decision === "lead" ? "lead" : c.status, sourceTier: tier, sourceUrl: item.url ?? null, observationId: null, dedupeKey: catalystDedupeKey(c) });
            stored++;
          }
        } catch (err) {
          log?.(`prospect: extract failed for "${item.title}": ${errorMessage(err)}`);
        }
      }
    }),
  );

  return { queries: queries.length, items: unique.length, stored };
}
