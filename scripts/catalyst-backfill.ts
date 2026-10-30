// One-off backfill: pull recent items from DEFAULT_SOURCES, extract future catalysts, upsert them.
// Run: npx tsx scripts/catalyst-backfill.ts  (logs on stderr, JSON summary on stdout)
import { DEFAULT_SOURCES } from "../src/presets.js";
import { getAdapter, parseSourceConfig } from "../src/sources/registry.js";
import type { RawItem } from "../src/types.js";
import { createCatalystExtractor, catalystDedupeKey } from "../src/catalysts/extract.js";
import { catalystDensity } from "../src/catalysts/density.js";
import { openStore } from "../src/db.js";

const env = (k: string) => process.env[k]?.trim() || undefined;
const DATABASE_URL = env("DATABASE_URL") ?? "file:catalyst-backfill.db";
const API_KEY = env("LLM_API_KEY") ?? env("OPENROUTER_API_KEY");
const MODEL = env("LLM_MODEL") ?? "z-ai/glm-5.3-flash";
const USER_AGENT = env("USER_AGENT") ?? "catalyst-service backfill (admin@lazuli.dev)";
const LOOKBACK_HOURS = Number(env("LOOKBACK_HOURS") ?? 72);
const MAX_ITEMS = Number(env("MAX_ITEMS") ?? 150);
const DAYS = Number(env("DAYS") ?? 7);

if (!API_KEY) {
  console.error("catalyst-backfill: set LLM_API_KEY (or OPENROUTER_API_KEY)");
  process.exit(1);
}

// Same pre-filter as the pipeline (not exported there).
const FUTURE_SIGNAL_RE = /\b(expect|expected|will|scheduled|deadline|by (q[1-4]|20\d\d)|pdufa|close[sd]? in|effective|vote|launch|completion|expir|lockup|hearing|ruling|202[6-9]|q[1-4])\b/i;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms)),
  ]);
}

const cutoff = Date.now() - LOOKBACK_HOURS * 3600_000;

// 1. Fetch items from each default source.
const items: RawItem[] = [];
for (const source of DEFAULT_SOURCES) {
  try {
    const adapter = getAdapter(source.type);
    const config = parseSourceConfig(source.type, source.config);
    const fetched = await withTimeout(adapter.fetch(config, { fetch, userAgent: USER_AGENT }), 20_000, source.name);
    items.push(...fetched);
    console.error(`[backfill] ${source.name}: ${fetched.length} items`);
  } catch (err) {
    console.error(`[backfill] ${source.name} failed: ${err instanceof Error ? err.message : err}`);
  }
}

// 2. Filter to fresh, future-signalling items; dedupe by title; cap.
const seenTitles = new Set<string>();
const candidates = items
  .filter((i) => {
    if (i.publishedAt && Date.parse(i.publishedAt) < cutoff) return false;
    return FUTURE_SIGNAL_RE.test(`${i.title} ${i.summary ?? ""}`);
  })
  .filter((i) => (seenTitles.has(i.title) ? false : seenTitles.add(i.title)))
  .slice(0, MAX_ITEMS);
console.error(`[backfill] ${candidates.length} candidates after filter/dedupe`);

// 3. Extract catalysts (concurrency 6) and upsert.
const extractor = createCatalystExtractor({ apiKey: API_KEY, baseUrl: "https://openrouter.ai/api/v1", model: MODEL });
const store = await openStore(DATABASE_URL);
const today = new Date().toISOString().slice(0, 10);
let extracted = 0;
const queue = [...candidates];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const cats = await extractor.extract(item);
        for (const c of cats) {
          await store.upsertCatalyst({ ...c, sourceUrl: item.url ?? null, observationId: null, dedupeKey: catalystDedupeKey(c) });
          extracted++;
        }
      } catch (err) {
        console.error(`[backfill] extract failed for "${item.title}": ${err instanceof Error ? err.message : err}`);
      }
    }
  }),
);

// 4. Report.
const upcoming = await store.listCatalysts({
  from: today,
  to: new Date(Date.parse(today) + DAYS * 86_400_000).toISOString().slice(0, 10),
});
const density = catalystDensity(upcoming, { today, horizonDays: DAYS })
  .slice(0, 15)
  .map(({ ticker, score, count, kinds }) => ({ ticker, score, count, kinds }));
console.log(JSON.stringify({ scanned: items.length, candidates: candidates.length, extracted, upcoming, density }));
