import { loadConfig, type Config } from "./config.js";
import { openStore, type Store } from "./db.js";
import { createCatalystExtractor } from "./catalysts/extract.js";
import { DEFAULT_THEMES, DEFAULT_WATCHLIST, runProspect } from "./catalysts/prospect.js";
import { maybeSendDigest } from "./digest.js";
import { runDueSources, type PipelineDeps } from "./pipeline.js";
import { createLocalEmbedder, EventIndex, warmEventMemory } from "./events.js";
import { createLlmFreshness, createPublisherReader } from "./freshness.js";
import { addPresetPillars, DEFAULT_SOURCES, PRESET_PILLARS, PRESET_THEMES, PRESET_TRADES, RETIRED_SOURCES } from "./presets.js";
import { heuristicScorer } from "./scoring/heuristic.js";
import { createLlmScorer } from "./scoring/llm.js";
import { createLlmTriage } from "./scoring/triage.js";
import { buildServer } from "./server.js";
import { errorMessage } from "./util.js";

const TICK_MS = 60_000;

async function seed(store: Store): Promise<void> {
  if ((await store.listThemes()).length === 0) {
    for (const t of PRESET_THEMES) await store.createTheme({ ...t, preset: true });
  }
  if ((await store.listTrades()).length === 0) {
    for (const t of PRESET_TRADES) await store.createTrade({ ...t, ...PRESET_PILLARS[t.name], preset: true });
  }
  await addPresetPillars(store);
  // Add any default source missing by name, so new defaults reach existing databases. Disable rather than delete to opt out.
  for (const s of DEFAULT_SOURCES) {
    if (!(await store.findSourceByName(s.name))) await store.createSource(s);
  }
  for (const name of RETIRED_SOURCES) {
    const s = await store.findSourceByName(name);
    if (s?.enabled) await store.setSourceEnabled(s.id, false);
  }
}

export function createDeps(config: Config, store: Store): PipelineDeps {
  return {
    store,
    scorer: config.llm ? createLlmScorer(config.llm) : heuristicScorer,
    triage: config.llm ? createLlmTriage(config.llm) : undefined,
    policy: config,
    events: config.eventGrouping ? new EventIndex(createLocalEmbedder()) : undefined,
    sourceContext: { fetch, userAgent: config.userAgent },
    freshness: { read: createPublisherReader(config.userAgent), judge: config.llm ? createLlmFreshness(config.llm) : undefined },
    catalysts: config.llm ? createCatalystExtractor(config.llm) : undefined,
    webhookUrl: config.alertWebhookUrl,
    ntfy: config.ntfy,
    barkUrl: config.barkUrl,
    barkMinScore: config.barkMinScore,
    barkRequiresMaterial: Boolean(config.llm),
    slackWebhookUrl: config.slackWebhookUrl,
    log: (msg) => console.log(`[mimir] ${msg}`),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await openStore(config.databaseUrl, config.tursoAuthToken);
  if (config.seedDefaults) await seed(store);
  const deps = createDeps(config, store);

  const app = buildServer(store, deps);
  await app.listen({ port: config.port, host: config.host });
  deps.log?.(`listening on :${config.port} (db ${config.databaseUrl.split("?")[0]}, scorer ${deps.scorer.name})`);

  if (deps.events) await warmEventMemory(store, deps.events, deps.scorer, Date.now(), deps.log);

  const watchlist = (process.env.CATALYST_WATCHLIST?.trim() || DEFAULT_WATCHLIST.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const prospect = () =>
    deps.catalysts && deps.store
      ? runProspect({ store, extractor: deps.catalysts, userAgent: config.userAgent, log: deps.log }, { watchlist, themes: [...DEFAULT_THEMES], maxItems: 60, perQuery: 5 })
      : Promise.resolve({ queries: 0, items: 0, stored: 0 });
  let lastProspectAt = 0;
  const PROSPECT_INTERVAL_MS = 6 * 3600_000;
  if (config.llm) void prospect();

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (config.llm && Date.now() - lastProspectAt >= PROSPECT_INTERVAL_MS) {
        lastProspectAt = Date.now();
        const counts = await prospect();
        deps.log?.(`prospect: ${counts.items} items from ${counts.queries} queries, ${counts.stored} catalysts`);
      }
      await runDueSources(deps, config.pollIntervalSeconds);
      if (config.digestTime && config.barkUrl) {
        await maybeSendDigest(
          { store, barkUrl: config.barkUrl, market: true, log: deps.log },
          { time: config.digestTime, timeZone: config.digestTimeZone },
        ).catch((err) => deps.log?.(`digest failed: ${errorMessage(err)}`));
      }
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), TICK_MS).unref();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
