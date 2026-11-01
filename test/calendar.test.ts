import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { renderCalendarPage, weekSunday } from "../src/catalysts/page.js";
import { deps, memoryStore } from "./helpers.js";
import type { Catalyst, CatalystInput } from "../src/types.js";

const KEY = "secret-key";
let app: Awaited<ReturnType<typeof buildServer>>;

const day = (offset: number) => new Date(Date.parse(new Date().toISOString().slice(0, 10)) + offset * 86_400_000).toISOString().slice(0, 10);
// A day guaranteed to be inside the week containing "today" (Sunday+6 >= any day of that week).
const inWeek = (i: number) => new Date(Date.parse(weekSunday(new Date().toISOString().slice(0, 10))) + i * 86_400_000).toISOString().slice(0, 10);
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
const full = (c: CatalystInput): Catalyst => ({ ...c, id: c.dedupeKey, datePrecision: c.datePrecision ?? "exact", impactWeight: null, createdAt: c.dateStart, updatedAt: c.dateStart }) as Catalyst;

beforeAll(async () => {
  process.env.CATALYST_API_KEY = KEY;
  const store = await memoryStore();
  await store.upsertCatalyst(cat({}));
  await store.upsertCatalyst(cat({ ticker: "EVIL", title: "Evil <script>alert(1)</script> CPI", dateStart: day(3), dateEnd: day(3), sourceUrl: null, dedupeKey: "evil", kind: "other", status: "scheduled" }));
  await store.upsertCatalyst(cat({ ticker: "NVDA", title: "Guidance cut", kind: "regulatory_decision", dateStart: day(4), dateEnd: day(4), sourceUrl: null, dedupeKey: "cluster" }));
  await store.upsertCatalyst(cat({ ticker: "NVDA", title: "Rumor mill", kind: "conference", dateStart: day(12), dateEnd: day(12), sourceUrl: null, dedupeKey: "rumor" }));
  app = buildServer(store, deps(store));
  await app.ready();
});
afterAll(async () => {
  delete process.env.CATALYST_API_KEY;
  await app.close();
});

describe("renderCalendarPage", () => {
  it("snaps any day of a week to its Sunday (default = asOf's week)", () => {
    const today = new Date().toISOString().slice(0, 10);
    const sun = weekSunday(today);
    const sunday = renderCalendarPage({ cats: [], asOf: today, all: false, week: sun });
    expect(renderCalendarPage({ cats: [], asOf: today, all: false, week: inWeek(3) })).toBe(sunday);
    expect(renderCalendarPage({ cats: [], asOf: today, all: false, week: inWeek(6) })).toBe(sunday);
    // No week param means asOf's week: same grid, links only differ by the explicit week param.
    const base = renderCalendarPage({ cats: [], asOf: today, all: false });
    const grid = (h: string) => h.slice(h.indexOf('class="week"'));
    expect(grid(base)).toBe(grid(sunday));
  });

  it("shows last refreshed as the max updatedAt minute (or never) and ✓ on on-pills", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(renderCalendarPage({ cats: [], asOf: today, all: false })).toContain("Last refreshed: never");
    const c = { ...full(cat({ dateStart: inWeek(6), dateEnd: inWeek(6), dedupeKey: "rf" })), updatedAt: "2026-02-12T09:05:33.000Z" };
    const html = renderCalendarPage({ cats: [c], asOf: today, all: false });
    expect(html).toContain("Last refreshed: 2026-02-12T09:05 UTC");
    expect(html).toContain("✓ Earnings");
    expect(html).toContain("text-decoration:line-through");
  });

  it("renders prev/today/next links preserving all=1", () => {
    const today = new Date().toISOString().slice(0, 10);
    const sun = weekSunday(today);
    const prev = new Date(Date.parse(`${sun}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    const next = new Date(Date.parse(`${sun}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const html = renderCalendarPage({ cats: [], asOf: today, all: true });
    expect(html).toContain(`href="?week=${prev}&all=1"`);
    expect(html).toContain(`href="?week=${next}&all=1"`);
    expect(html).toContain('href="?"');
    expect(html).toContain("‹ Prev");
    expect(html).toContain("Next ›");
    expect(html).toContain('href="?all=1"');
  });

  it("shows focus/megacap earnings as chips and collapses the rest into +N earnings", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderCalendarPage({
      cats: [
        full(cat({ dateStart: inWeek(6), dateEnd: inWeek(6), dedupeKey: "nvda" })),
        full(cat({ ticker: "MEGA", dateStart: inWeek(6), dateEnd: inWeek(6), themes: ["megacap"], dedupeKey: "mega" })),
        full(cat({ ticker: "XYZ", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "xyz" })),
        full(cat({ ticker: "ABC", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "abc" })),
      ],
      asOf: today,
      all: false,
    });
    expect(html).toContain("<strong>NVDA</strong>");
    expect(html).toContain("<strong>MEGA</strong>");
    expect(html).not.toContain("<strong>XYZ</strong>");
    expect(html).not.toContain("<strong>ABC</strong>");
    expect(html).toContain("+2 earnings");
    expect(html).toContain("XYZ");
    expect(html).toContain("ABC");
    expect(html).toContain("<details");
  });

  it("collapses even with all=1 but shows non-decision-grade items unfiltered", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderCalendarPage({
      cats: [
        full(cat({ ticker: "XYZ", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "xyz" })),
        full(cat({ ticker: "ABC", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "abc" })),
        full(cat({ ticker: "NVDA", title: "Rumor mill", kind: "conference", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "rumor" })),
      ],
      asOf: today,
      all: true,
    });
    expect(html).toContain("Rumor mill");
    expect(html).toContain("+2 earnings");
  });

  it("renders sector and peers for NVDA cluster", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderCalendarPage({
      cats: [
        full(cat({ ticker: "NVDA", title: "Guidance cut", kind: "regulatory_decision", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "sector" })),
        full(cat({ ticker: "NVDA", title: "Rumor mill", kind: "conference", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "sector-rumor" })),
      ],
      asOf: today,
      all: false,
    });
    expect(html).toContain("Sector: semis");
  });

  it("colors chips by kind and escapes all text", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderCalendarPage({
      cats: [
        full(cat({ dateStart: inWeek(6), dateEnd: inWeek(6), dedupeKey: "earn" })),
        full(cat({ ticker: null, kind: "macro", title: "US CPI release", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "cpi" })),
        full(cat({ ticker: null, kind: "election", title: "Senate race", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "elec" })),
        full(cat({ ticker: "EVIL&<>", title: `Tick "</b>`, kind: "regulatory_decision", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "evil" })),
      ],
      asOf: today,
      all: false,
    });
    expect(html).toContain('class="chip k-earnings"');
    expect(html).toContain('class="chip k-macro"');
    expect(html).toContain('class="chip k-election"');
    expect(html).toContain('class="chip k-other"');
    expect(html).toContain("★");
    expect(html).toContain("📌");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("EVIL&<>");
    expect(html).toContain("EVIL&amp;&lt;&gt;");
  });

  it("renders no lead-bucket badges (priced/actionable/watchlist/distant)", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderCalendarPage({ cats: [full(cat({ dateStart: inWeek(6), dateEnd: inWeek(6), dedupeKey: "nvda-badge" }))], asOf: today, all: false });
    expect(html).not.toContain('class="badge');
    for (const b of ["b-priced", "b-actionable", "b-watchlist", "b-distant"]) expect(html).not.toContain(b);
  });

  it("renders filter pills and styles shown ones filled with aria-pressed", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderCalendarPage({ cats: [], asOf: today, all: false });
    expect(html).toContain('class="pill pill-on" aria-pressed="true" href="?hide=earnings">✓ Earnings</a>');
    expect(html).toContain('class="pill pill-on" aria-pressed="true" href="?hide=macro">✓ Macro</a>');
    expect(html).toContain('class="pill pill-on" aria-pressed="true" href="?hide=global">✓ Global</a>');
  });

  it("hide=earnings removes earnings chips from the week grid but keeps macro and global", () => {
    const today = new Date().toISOString().slice(0, 10);
    const cats = [
      full(cat({ dateStart: inWeek(6), dateEnd: inWeek(6), dedupeKey: "he1" })),
      full(cat({ ticker: null, kind: "macro", title: "US CPI release", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "hm1" })),
      full(cat({ ticker: null, kind: "election", title: "Senate race", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "hg1" })),
    ];
    const grid = (html: string) => html.slice(html.indexOf('class="week"'));
    const base = grid(renderCalendarPage({ cats, asOf: today, all: false }));
    expect(base).toContain("NVDA");
    expect(base).toContain("US CPI release");
    expect(base).toContain("Senate race");
    const noEarnings = grid(renderCalendarPage({ cats, asOf: today, all: false, hide: "earnings" }));
    expect(noEarnings).not.toContain("NVDA");
    expect(noEarnings).toContain("US CPI release");
    expect(noEarnings).toContain("Senate race");
    const noMacroGlobal = grid(renderCalendarPage({ cats, asOf: today, all: false, hide: "macro,global" }));
    expect(noMacroGlobal).toContain("NVDA");
    expect(noMacroGlobal).not.toContain("US CPI release");
    expect(noMacroGlobal).not.toContain("Senate race");
  });

  it("ignores invalid hide values", () => {
    const today = new Date().toISOString().slice(0, 10);
    const base = renderCalendarPage({ cats: [], asOf: today, all: false });
    for (const hide of ["garbage", "earnings,bogus", "EARNINGS"]) {
      expect(renderCalendarPage({ cats: [], asOf: today, all: false, hide })).toBe(base);
    }
  });

  it("pill, prev/today/next links preserve week, all and hide", () => {
    const today = new Date().toISOString().slice(0, 10);
    const sun = weekSunday(today);
    const prev = new Date(Date.parse(`${sun}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    const next = new Date(Date.parse(`${sun}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const html = renderCalendarPage({ cats: [], asOf: today, all: true, week: sun, hide: "earnings" });
    expect(html).toContain(`aria-pressed="false" href="?week=${sun}&all=1">Earnings</a>`);
    expect(html).toContain(`aria-pressed="true" href="?week=${sun}&all=1&hide=earnings,macro">✓ Macro</a>`);
    expect(html).toContain(`aria-pressed="true" href="?week=${sun}&all=1&hide=earnings,global">✓ Global</a>`);
    expect(html).toContain(`href="?week=${prev}&all=1&hide=earnings"`);
    expect(html).toContain(`href="?week=${next}&all=1&hide=earnings"`);
    expect(html).toContain('href="?all=1&hide=earnings"');
  });

  it("shows days-until labels on chips (in Nd, today when 0)", () => {
    const today = "2026-10-28";
    const html = renderCalendarPage({
      cats: [
        full(cat({ dateStart: "2026-10-28", dateEnd: "2026-10-28", dedupeKey: "until1" })),
        full(cat({ dateStart: "2026-10-31", dateEnd: "2026-10-31", dedupeKey: "until2" }))
      ],
      asOf: today,
      all: false,
    });
    expect(html).toContain('<span class="until">today</span>');
    expect(html).toContain('<span class="until">in 3d</span>');
    for (const m of html.match(/<span class="until">[^<]*<\/span>/g) ?? []) {
      expect(m).toMatch(/^<span class="until">(in -?\d+d|today)<\/span>$/);
    }
  });

  it("keeps day headers sticky and full-width chips on mobile", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderCalendarPage({ cats: [], asOf: today, all: false });
    expect(html).toContain("@media (max-width:700px)");
    expect(html).toContain("grid-template-columns:1fr");
    expect(html).toContain("position:sticky");
    expect(html).toContain("min-height:40px");
  });

  it("renders exact why-material sentence for a 2-kind cluster", () => {
    const wk = weekSunday("2026-06-10");
    const wd = (i: number) => new Date(Date.parse(wk) + i * 86_400_000).toISOString().slice(0, 10);
    const html = renderCalendarPage({
      cats: [
        full(cat({ ticker: "NVDA", title: "Guidance cut", kind: "earnings", dateStart: wd(3), dateEnd: wd(3), sourceUrl: null, dedupeKey: "wm-1" })),
        full(cat({ ticker: "NVDA", title: "Rumor mill", kind: "conference", dateStart: wd(3), dateEnd: wd(3), sourceUrl: null, dedupeKey: "wm-2" })),
      ],
      asOf: wk,
      all: false,
    });
    expect(html).toContain("2 distinct catalyst types within 10 trading days (earnings: tier 3, conference: tier 1); cluster bonus +1.5; first event in 3d.");
    expect(html).not.toContain("N distinct");
  });

  it("shows multi-day events on every day of their range in the shown week", () => {
    const wk = weekSunday("2026-06-10");
    const wd = (i: number) => new Date(Date.parse(wk) + i * 86_400_000).toISOString().slice(0, 10);
    const html = renderCalendarPage({
      cats: [full(cat({ ticker: null, kind: "macro", title: "FOMC rate decision Jun 17 (meeting Jun 16–Jun 17)", dateStart: wd(2), dateEnd: wd(3), sourceUrl: null, dedupeKey: "fomc" }))],
      asOf: wk,
      all: false,
    });
    expect(html.match(/FOMC rate decision/g)?.length).toBe(2); // once per day cell
  });

  it("escapes affected tickers in cluster section", () => {
    const wk = weekSunday("2026-06-10");
    const wd = (i: number) => new Date(Date.parse(wk) + i * 86_400_000).toISOString().slice(0, 10);
    const html = renderCalendarPage({
      cats: [
        full(cat({ ticker: "NVDA", title: "Guidance cut", kind: "regulatory_decision", dateStart: wd(2), dateEnd: wd(2), sourceUrl: null, affectedTickers: ["A<b>"], dedupeKey: "esc-1" })),
        full(cat({ ticker: "NVDA", title: "Rumor mill", kind: "conference", dateStart: wd(2), dateEnd: wd(2), sourceUrl: null, dedupeKey: "esc-2" })),
      ],
      asOf: wk,
      all: false,
    });
    expect(html).toContain("Likely affected: A&lt;b&gt;");
    expect(html).not.toContain("A<b>");
  });

  it("renders readable cluster summary and per-event date certainty", () => {
    const wk = weekSunday("2026-11-10");
    const wd = (i: number) => new Date(Date.parse(wk) + i * 86_400_000).toISOString().slice(0, 10);
    const html = renderCalendarPage({
      cats: [
        full(cat({ ticker: "NVDA", title: "Q3 earnings", kind: "earnings", dateStart: wd(3), dateEnd: wd(3), sourceUrl: null, dedupeKey: "sum-1" })),
        full(cat({
          ticker: null,
          title: "BIS affiliates rule back in force Nov 11 (suspension ends Nov 10) — Suspension of Export Controls",
          kind: "rule_effective",
          dateStart: wd(4),
          dateEnd: wd(4),
          datePrecision: "window",
          affectedTickers: ["NVDA"],
          sourceUrl: null,
          dedupeKey: "sum-2",
        })),
      ],
      asOf: wk,
      all: false,
    });
    const summary = html.match(/<details class="cluster"><summary>([^<]*)<\/summary>/);
    expect(summary).not.toBeNull();
    expect(summary![1]).toMatch(/^NVDA earnings \+ BIS affiliates rule · \d+\.\d · Nov 11–12$/);
    expect(html).toContain(`${wd(3)} (exact) earnings Q3 earnings`);
    expect(html).toContain(`${wd(4)} (window) rule_effective`);
    expect(html).not.toContain("<script>");
  });

  it("escapes cluster ticker with HTML characters", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderCalendarPage({
      cats: [
        full(cat({ ticker: "X<b>", title: "Test catalyst", kind: "regulatory_decision", dateStart: inWeek(6), dateEnd: inWeek(6), sourceUrl: null, dedupeKey: "cluster-test" })),
      ],
      asOf: today,
      all: false,
    });
    expect(html).toContain("X&lt;b&gt;");
    expect(html).not.toContain("X<b>");
  });
});

describe("GET /calendar", () => {
  it("is public and serves escaped html for the requested week", async () => {
    const res = await app.inject({ method: "GET", url: `/calendar?week=${weekSunday(day(3))}&all=1` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    const html = res.body;
    expect(html).toContain("Week of");
    expect(html).toContain('class="week"');
    expect(html).not.toContain("<script>");
    expect(html).toContain('&lt;script&gt;');
  });

  it("never allows non-http hrefs", async () => {
    const store = await memoryStore();
    await store.upsertCatalyst(cat({ title: "Phishing", sourceUrl: "javascript:alert(1)", dedupeKey: "js" }));
    const evil = buildServer(store, deps(store));
    await evil.ready();
    expect((await evil.inject({ method: "GET", url: "/calendar" })).body).not.toContain("javascript:");
    await evil.close();
  });

  it("fetches catalysts covering the requested week, not just from today", async () => {
    const res = await app.inject({ method: "GET", url: `/calendar?week=${weekSunday(day(10))}` });
    expect(res.body).toContain("Earnings call");
    expect(res.body).toContain('href="https://example.com/ir"');
    expect(res.body).toContain('target="_blank" rel="noopener"');
    const rumor = await app.inject({ method: "GET", url: `/calendar?week=${weekSunday(day(12))}&all=1` });
    expect(rumor.body).toContain("Rumor mill");
  });

  it("passes hide through and filters the week grid", async () => {
    const res = await app.inject({ method: "GET", url: `/calendar?week=${weekSunday(day(10))}&hide=earnings` });
    const grid = res.body.slice(res.body.indexOf('class="week"'));
    expect(grid).not.toContain("Earnings call");
  });

  it("ignores invalid week params", async () => {
    const base = await app.inject({ method: "GET", url: "/calendar" });
    for (const bad of ["garbage", "2026-1-1", "2026-13-45", "2026-02-30"]) {
      const res = await app.inject({ method: "GET", url: `/calendar?week=${bad}` });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(base.body);
    }
  });
});