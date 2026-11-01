import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, etParts, fixedClock, marketToday, nyDate, systemClock } from "../src/clock.js";
import { buildServer } from "../src/server.js";
import { deps, memoryStore } from "./helpers.js";
import type { CatalystInput } from "../src/types.js";

const MIN = 60_000;
const DAY_SAMPLES: Record<string, number> = { "2026-03-08": 23 * 4, "2026-11-01": 25 * 4 };

/** UTC instant of 00:00 ET on the given NY date (04:00Z for EDT, 05:00Z for EST). */
function startOfNyDay(date: string): number {
  const start = Date.parse(`${date}T04:00:00Z`);
  return nyDate(new Date(start)) === date ? start : start + 60 * MIN;
}

describe("nyDate/marketToday across the full UTC span of each NY day", () => {
  it("every 15-minute instant of the NY day maps back to that date", () => {
    for (const date of ["2026-01-15", "2026-03-08", "2026-07-04", "2026-11-01", "2026-12-31"]) {
      const start = startOfNyDay(date);
      const samples: Date[] = [];
      for (let t = start; nyDate(new Date(t)) === date; t += 15 * MIN) samples.push(new Date(t));
      expect(samples, date).toHaveLength(DAY_SAMPLES[date] ?? 24 * 4);
      for (const t of samples) expect(marketToday(fixedClock(t)), date).toBe(date);
    }
  });

  it("23:30 and 00:01 ET land on the expected ET dates", () => {
    expect(marketToday(fixedClock("2026-11-01T03:30:00Z"))).toBe("2026-10-31");
    expect(marketToday(fixedClock("2026-03-09T03:30:00Z"))).toBe("2026-03-08");
    expect(marketToday(fixedClock("2026-07-05T03:30:00Z"))).toBe("2026-07-04");
    expect(marketToday(fixedClock("2026-11-01T04:01:00Z"))).toBe("2026-11-01");
    expect(marketToday(fixedClock("2026-03-08T05:01:00Z"))).toBe("2026-03-08");
  });

  it("etParts returns the ET date and 24h time", () => {
    expect(etParts(new Date("2026-11-01T03:30:00Z"))).toEqual({ date: "2026-10-31", time: "23:30" });
    expect(etParts(new Date("2026-03-08T05:01:00Z"))).toEqual({ date: "2026-03-08", time: "00:01" });
  });
});

describe("addDays", () => {
  it("is associative: addDays(addDays(d,a),b) === addDays(d,a+b)", () => {
    const dates = [
      ...Array.from({ length: 37 }, (_, i) => addDays("2026-01-01", i * 10)),
      "2026-03-07", "2026-03-08", "2026-11-01", "2026-12-31",
    ];
    for (const d of dates)
      for (let a = -40; a <= 40; a += 7)
        for (let b = -40; b <= 40; b += 7)
          expect(addDays(addDays(d, a), b), `${d} ${a} ${b}`).toBe(addDays(d, a + b));
  });

  it("rolls over DST, year, and leap-year boundaries", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("systemClock", () => {
  it("returns a Date close to Date.now()", () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(5_000);
  });
});

describe("endpoint ET day boundary", () => {
  const KEY = "secret-key";
  const cat = (overrides: Partial<CatalystInput>): CatalystInput => ({
    ticker: "NVDA",
    title: "Earnings call",
    kind: "earnings",
    status: "scheduled",
    dateStart: "2026-10-31",
    dateEnd: "2026-10-31",
    confidence: 1,
    sourceTier: 1,
    themes: [],
    affectedTickers: [],
    sourceUrl: "https://example.com/ir",
    observationId: null,
    dedupeKey: "k",
    ...overrides,
  });

  // One store/server; the clock's returned instant is swapped per request (ids and updatedAt stay stable).
  let app: Awaited<ReturnType<typeof buildServer>>;
  let at = new Date();
  const clock = { now: () => new Date(at) };

  beforeAll(async () => {
    process.env.CATALYST_API_KEY = KEY;
    const store = await memoryStore();
    await store.upsertCatalyst(cat({ title: "Oct 31 event", dedupeKey: "oct31" }));
    await store.upsertCatalyst(cat({ title: "Nov 5 event", dateStart: "2026-11-05", dateEnd: "2026-11-05", dedupeKey: "nov5" }));
    app = buildServer(store, deps(store, { clock }));
    await app.ready();
  });
  afterAll(async () => {
    delete process.env.CATALYST_API_KEY;
    await app.close();
  });

  const serveAt = async (iso: string) => {
    at = new Date(iso);
  };

  it("at 11:30 PM ET Oct 31 (UTC already Nov 1) the Oct 31 event is still today", async () => {
    await serveAt("2026-11-01T03:30:00Z");
    const res = await app.inject({ method: "GET", url: "/api/events" });
    expect(res.statusCode).toBe(200);
    const cats = JSON.parse(res.body) as Array<{ dateStart: string }>;
    expect(cats.some((c) => c.dateStart === "2026-10-31")).toBe(true);
    const cal = await app.inject({ method: "GET", url: "/calendar" });
    expect(cal.statusCode).toBe(200);
    expect(cal.body).toContain("Oct 31 event");
  });

  it("the /api/events response is identical at every sampled instant of ET Oct 31", async () => {
    const instants = [
      "2026-10-31T04:01:00Z", // 00:01 ET
      "2026-10-31T13:30:00Z", // 09:30 ET
      "2026-10-31T20:00:00Z", // 16:00 ET
      "2026-11-01T03:30:00Z", // 23:30 ET
      "2026-11-01T03:59:00Z", // 23:59 ET
    ];
    const bodies: string[] = [];
    for (const iso of instants) {
      await serveAt(iso);
      const res = await app.inject({ method: "GET", url: "/api/events" });
      expect(res.statusCode).toBe(200);
      bodies.push(res.body);
      expect(JSON.parse(res.body)).toEqual(expect.arrayContaining([expect.objectContaining({ dateStart: "2026-10-31" })]));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("at 01:00 ET Nov 1 the Oct 31 event is no longer in /api/events", async () => {
    await serveAt("2026-11-01T05:00:00Z");
    const res = await app.inject({ method: "GET", url: "/api/events" });
    expect(res.statusCode).toBe(200);
    const cats = JSON.parse(res.body) as Array<{ dateStart: string }>;
    expect(cats.some((c) => c.dateStart === "2026-10-31")).toBe(false);
  });
});
