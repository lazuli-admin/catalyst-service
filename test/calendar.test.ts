import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { deps, memoryStore } from "./helpers.js";
import type { CatalystInput } from "../src/types.js";

const KEY = "secret-key";
let app: Awaited<ReturnType<typeof buildServer>>;

const day = (offset: number) => new Date(Date.parse(new Date().toISOString().slice(0, 10)) + offset * 86_400_000).toISOString().slice(0, 10);
const cat = (overrides: Partial<CatalystInput>): CatalystInput => ({
  ticker: "NVDA",
  title: "Earnings call",
  kind: "earnings",
  status: "scheduled",
  dateStart: day(10),
  dateEnd: day(10),
  confidence: 1,
  sourceTier: 1,
  themes: [],
  affectedTickers: [],
  sourceUrl: "https://example.com/ir",
  observationId: null,
  dedupeKey: overrides.title ?? "k",
  ...overrides,
});

beforeAll(async () => {
  process.env.CATALYST_API_KEY = KEY;
  const store = await memoryStore();
  await store.upsertCatalyst(cat({}));
  await store.upsertCatalyst(cat({ ticker: null, title: "Evil <script>alert(1)</script> CPI", dateStart: day(3), dateEnd: day(3), sourceUrl: null, dedupeKey: "evil" }));
  await store.upsertCatalyst(cat({ ticker: "NVDA", title: "Guidance cut", kind: "regulatory_decision", dateStart: day(4), dateEnd: day(4), sourceUrl: null, dedupeKey: "cluster" }));
  await store.upsertCatalyst(cat({ ticker: "NVDA", title: "Rumor mill", kind: "conference", dateStart: day(12), dateEnd: day(12), sourceUrl: null, dedupeKey: "rumor" }));
  app = buildServer(store, deps(store));
  await app.ready();
});
afterAll(async () => {
  delete process.env.CATALYST_API_KEY;
  await app.close();
});

describe("GET /calendar", () => {
  it("is public and serves escaped html", async () => {
    const res = await app.inject({ method: "GET", url: "/calendar" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    const html = res.body;
    expect(html).toContain("Dense clusters");
    expect(html).not.toContain("<script>");
    const amp = String.fromCharCode(38);
    expect(html).toContain(`${amp}#60;script${amp}#62;`);
    expect(html).toContain("MACRO");
    expect(html).toContain('href="https://example.com/ir"');
    expect(html).toContain('target="_blank" rel="noopener"');
  });

  it("never allows non-http hrefs", async () => {
    const store = await memoryStore();
    await store.upsertCatalyst(cat({ title: "Phishing", sourceUrl: "javascript:alert(1)", dedupeKey: "js" }));
    const evil = buildServer(store, deps(store));
    await evil.ready();
    expect((await evil.inject({ method: "GET", url: "/calendar" })).body).not.toContain("javascript:");
    await evil.close();
  });

  it("serves /catalysts publicly", async () => {
    const ranked = await app.inject({ method: "GET", url: "/catalysts" });
    expect(ranked.statusCode).toBe(200);
    // Default view: the weight-1 conference item is filtered out.
    expect(ranked.json().map((r: { title: string }) => r.title).sort()).toEqual(["Earnings call", "Evil <script>alert(1)</script> CPI", "Guidance cut"]);
    const all = await app.inject({ method: "GET", url: "/catalysts?all=1", headers: { "x-api-key": KEY } });
    expect(all.json()).toHaveLength(4);
  });
});
