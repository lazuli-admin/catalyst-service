import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { catalystDensity } from "./catalysts/density.js";
import { rankCatalysts } from "./catalysts/ranked.js";
import { isDate, renderCalendarPage, weekSunday } from "./catalysts/page.js";
import { addDays, marketToday, systemClock } from "./clock.js";
import type { Store } from "./db.js";
import { createSyncLock, type SyncLock } from "./lock.js";
import { processItems, runSource, type PipelineDeps } from "./pipeline.js";
import { listAdapters, parseSourceConfig } from "./sources/registry.js";
import { EFFECTS, type Effect } from "./types.js";

const ThemeBody = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  keywords: z.array(z.string().min(1)).default([]),
});

const terms = z.array(z.string().min(1)).default([]);
const PillarBody = z.object({
  statement: z.string().min(1),
  signals: z
    .array(z.object({ description: z.string().min(1), effect: z.enum(EFFECTS as [Effect, ...Effect[]]) }))
    .default([]),
});

const TradeBody = z.object({
  name: z.string().min(1),
  thesis: z.string().default(""),
  keywords: terms,
  tickers: terms,
  strengthens: terms,
  weakens: terms,
  entities: z.array(z.object({ name: z.string().min(1), aliases: terms })).default([]),
  pillars: z.array(PillarBody).default([]),
});

const EntityBody = z.object({
  name: z.string().min(1),
  kind: z.enum(["ticker", "company", "person", "project", "regulation", "other"]).default("company"),
  aliases: z.array(z.string().min(1)).default([]),
});

const SourceBody = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  config: z.unknown().default({}),
  enabled: z.boolean().default(true),
  weight: z.number().min(0).max(2).default(1),
  pollIntervalSeconds: z.number().int().min(30).nullable().default(null),
});

const IngestBody = z.object({
  source: z.string().default("Inbound (POST /ingest)"),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1),
        url: z.string().optional(),
        summary: z.string().optional(),
        publishedAt: z.string().optional(),
      }),
    )
    .min(1)
    .max(500),
});

const Limit = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) });
const IdParam = z.object({ id: z.string() });

// Length-safe constant-time comparison: pads by comparing b against itself when lengths differ, so the
// timing profile does not leak whether the key length matched.
export function safeEqual(a: string | undefined, b: string): boolean {
  const bb = Buffer.from(b);
  if (a === undefined) return timingSafeEqual(bb, bb) && false;
  const ab = Buffer.from(a);
  if (ab.length !== bb.length) return timingSafeEqual(bb, bb) && false;
  return timingSafeEqual(ab, bb);
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

export function buildServer(store: Store, deps: PipelineDeps, opts: { lock?: SyncLock; host?: string } = {}): FastifyInstance {
  const clock = deps.clock ?? systemClock;
  const lock = opts.lock ?? createSyncLock();
  const app = Fastify({ logger: false });

  // When CATALYST_API_KEY is set, only mutating methods require the x-api-key header (GET/HEAD are public).
  const apiKey = process.env.CATALYST_API_KEY?.trim();
  if (!apiKey && (process.env.NODE_ENV === "production" || (opts.host !== undefined && !isLoopbackHost(opts.host))))
    throw new Error("CATALYST_API_KEY must be set in production or when listening on a non-loopback host");
  if (apiKey) {
    app.addHook("onRequest", async (req, reply) => {
      if (req.method === "GET" || req.method === "HEAD") return;
      if (!safeEqual(req.headers["x-api-key"] as string | undefined, apiKey)) return reply.status(401).send({ error: "unauthorized" });
    });
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.status(400).send({ error: "invalid_request", issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: err instanceof Error ? err.message : String(err) });
  });

  const notFound = { error: "not_found" };

  app.get("/health", async () => ({ ok: true, locks: lock.stats() }));
  app.get("/source-types", async () => listAdapters());

  app.get("/themes", async () => store.listThemes());
  app.post("/themes", async (req, reply) => reply.status(201).send(await store.createTheme(ThemeBody.parse(req.body))));
  app.delete("/themes/:id", async (req, reply) =>
    (await store.deleteTheme(IdParam.parse(req.params).id)) ? reply.status(204).send() : reply.status(404).send(notFound),
  );

  app.get("/trades", async () => store.listTrades());
  app.post("/trades", async (req, reply) => reply.status(201).send(await store.createTrade(TradeBody.parse(req.body))));
  // Pillars are only ever added or retired (never edited in place), so past impacts keep their meaning.
  app.post("/trades/:id/pillars", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.listTrades()).some((t) => t.id === id)) return reply.status(404).send({ error: "not found" });
    return reply.status(201).send(await store.addPillar(id, PillarBody.parse(req.body)));
  });
  app.patch("/pillars/:id", async (req, reply) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const ok = await store.setPillarActive((req.params as { id: string }).id, active);
    return ok ? reply.status(204).send() : reply.status(404).send({ error: "not found" });
  });
  app.delete("/trades/:id", async (req, reply) =>
    (await store.deleteTrade(IdParam.parse(req.params).id)) ? reply.status(204).send() : reply.status(404).send(notFound),
  );

  app.get("/entities", async () => store.listEntities());
  app.post("/entities", async (req, reply) => reply.status(201).send(await store.createEntity(EntityBody.parse(req.body))));
  app.delete("/entities/:id", async (req, reply) =>
    (await store.deleteEntity(IdParam.parse(req.params).id)) ? reply.status(204).send() : reply.status(404).send(notFound),
  );

  app.get("/sources", async () => store.listSources());
  app.post("/sources", async (req, reply) => {
    const body = SourceBody.parse(req.body);
    const config = parseSourceConfig(body.type, body.config);
    return reply.status(201).send(await store.createSource({ ...body, config }));
  });
  app.patch("/sources/:id", async (req, reply) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    return (await store.setSourceEnabled(IdParam.parse(req.params).id, enabled))
      ? store.getSource(IdParam.parse(req.params).id)
      : reply.status(404).send(notFound);
  });
  app.delete("/sources/:id", async (req, reply) =>
    (await store.deleteSource(IdParam.parse(req.params).id)) ? reply.status(204).send() : reply.status(404).send(notFound),
  );
  app.post("/sources/:id/run", async (req, reply) => {
    const source = await store.getSource(IdParam.parse(req.params).id);
    if (!source) return reply.status(404).send(notFound);
    if (lock.isRunning("source-poll")) {
      lock.recordSkip("source-poll");
      return reply.status(409).send({ error: "source_poll_running" });
    }
    const result = await lock.run("source-poll", () => runSource(deps, source));
    return result === undefined ? reply.status(409).send({ error: "source_poll_running" }) : result;
  });

  app.post("/ingest", async (req) => {
    const body = IngestBody.parse(req.body);
    const source =
      (await store.findSourceByName(body.source)) ??
      (await store.createSource({ type: "push", name: body.source, config: {} }));
    const items = body.items.map((i) => ({ ...i, externalId: i.id ?? i.url ?? i.title }));
    return processItems(deps, source, items);
  });

  const CatalystQuery = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ticker: z.string().optional(),
    theme: z.string().optional(),
    include_leads: z.string().optional(),
    all: z.string().optional(),
  });
  const listCatalysts = async (req: FastifyRequest) => {
    const q = CatalystQuery.parse(req.query);
    const today = marketToday(clock);
    const to = q.to ?? addDays(today, 90);
    const cats = await store.listCatalysts({ from: q.from ?? today, to, ticker: q.ticker, theme: q.theme, includeLeads: q.include_leads === "1" });
    return rankCatalysts(cats, { asOf: today, all: q.all === "1" });
  };
  app.get("/catalysts", listCatalysts);
  // Public mirror of /catalysts: GET routes bypass the API-key hook above.
  app.get("/api/events", listCatalysts);
  app.get("/catalysts/density", async (req) => {
    const { days, include_leads } = z.object({ days: z.coerce.number().int().min(1).max(365).default(90), include_leads: z.string().optional() }).parse(req.query);
    const today = marketToday(clock);
    const cats = await store.listCatalysts({ from: today, to: addDays(today, days), includeLeads: include_leads === "1" });
    return catalystDensity(cats, { asOf: today });
  });

  // Public, like /health: server-rendered, no API key required.
  app.get("/calendar", async (req, reply) => {
    const { days, all, week, hide } = z.object({ days: z.coerce.number().int().min(1).max(120).default(30), all: z.string().optional(), week: z.string().optional(), hide: z.string().optional() }).parse(req.query);
    const today = marketToday(clock);
    const w = week && isDate(week) ? weekSunday(week) : null;
    const from = w ?? today;
    const to = w ? addDays(w, 6) : addDays(today, days);
    const cats = await store.listCatalysts({ from, to, includeLeads: all === "1" });
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "public, max-age=300")
      .send(renderCalendarPage({ cats, asOf: today, all: all === "1", week: w ?? undefined, hide }));
  });

  app.get("/observations", async (req) => store.listObservations(Limit.parse(req.query).limit));
  app.get("/alerts", async (req) => store.listAlerts(Limit.parse(req.query).limit));

  return app;
}
