import { describe, expect, it, vi } from "vitest";
import { IR_SOURCES, syncCalendars } from "../src/catalysts/calendars.js";
import { memoryStore } from "./helpers.js";
import type { Catalyst } from "../src/types.js";

const EARNINGS_URL = "https://api.nasdaq.com/api/calendar/earnings?date=";
const FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

const res = (body: unknown) => ({ ok: true, json: async () => body, text: async () => String(body) });

function mockFetch(earnings: unknown) {
  return vi.fn(async (url: string) => {
    if (!url.startsWith(EARNINGS_URL)) return url === FOMC_URL ? res("") : res({});
    return url.includes("date=2026-02-12") ? res(earnings) : res({ data: { rows: null } });
  });
}

const store = () => ({
  upsertCatalyst: vi.fn(async (c: unknown) => ({ ...(c as object) } as Catalyst)),
  purgeLegacyMacro: vi.fn(async () => {}),
  purgeStaleCatalysts: vi.fn(async () => 0),
  listStaleCatalysts: vi.fn(async () => []),
});

const opts = { from: "2026-02-12", days: 5, watchlist: ["smol"], minMarketCap: 50e9 };
// 2026-02-12 is a Thursday; 02-14/15 are Sat/Sun. Only Thursday returns data; other days return null rows.

describe("syncCalendars", () => {
  it("keeps watchlist small-cap and big-cap earnings, drops small non-watchlist; skips weekend", async () => {
    const earnings = { data: { rows: [
      { symbol: "SMOL", name: "SmallCap Inc", marketCap: "$1,000,000", time: "time-pre-market" },
      { symbol: "BIGC", name: "BigCap Corp", marketCap: "$253,966,172,000", time: "time-after-hours" },
      { symbol: "TINY", name: "Tiny Ltd", marketCap: "$2,000,000", time: "time-not-supplied" },
    ] } };
    const fetchImpl = mockFetch(earnings);
    const s = store();
    const counts = await syncCalendars(s as never, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(counts).toEqual({ earnings: 2, macro: 0 });
    const titles = s.upsertCatalyst.mock.calls.map(([c]) => (c as { title: string }).title);
    expect(titles).toContain("SmallCap Inc earnings (bmo)");
    expect(titles).toContain("BigCap Corp earnings (amc)");
    expect(titles.some((t) => t.includes("Tiny Ltd"))).toBe(false);
    const tickers = s.upsertCatalyst.mock.calls.map(([c]) => (c as { ticker: string | null }).ticker);
    expect(tickers).toEqual(["SMOL", "BIGC"]);
    const themes = s.upsertCatalyst.mock.calls.map(([c]) => (c as { themes: string[] }).themes);
    expect(themes).toEqual([[], ["megacap"]]);
    // Mon-Fri = 3 fetch pairs (Sat/Sun skipped); watch for date correctness
    const urls = fetchImpl.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("date=2026-02-12"))).toBe(true);
    expect(urls.some((u) => u.includes("date=2026-02-14"))).toBe(false);
    expect(urls.some((u) => u.includes("date=2026-02-15"))).toBe(false);
    expect(urls.some((u) => u.startsWith("https://api.nasdaq.com/api/calendar/economicevents"))).toBe(false);
    // dedupeKey set
    expect(s.upsertCatalyst.mock.calls.every(([c]) => typeof (c as { dedupeKey: string }).dedupeKey === "string" && (c as { dedupeKey: string }).dedupeKey.length > 0)).toBe(true);
  });

  it("purges legacy macro rows once and syncs primary macro into the horizon", async () => {
    const fomc = `<h5>2026 FOMC Meetings</h5><div class="fomc-meeting"><div class="fomc-meeting__month"><strong>February</strong></div><div class="fomc-meeting__date"><p>16-17</p></div></div>`;
    const fetchImpl = vi.fn(async (url: string) => (url.startsWith(EARNINGS_URL) ? res({ data: { rows: null } }) : url === FOMC_URL ? res(fomc) : res({})));
    const s = store();
    const counts = await syncCalendars(s as never, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(s.purgeLegacyMacro).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({ earnings: 0, macro: 1 });
    const macro = s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst & { dedupeKey: string }).filter((c) => c.kind === "macro");
    expect(macro).toEqual([expect.objectContaining({ title: "FOMC rate decision Feb 17 (meeting Feb 16–Feb 17) · decision 2:00 PM ET", dateStart: "2026-02-16", dateEnd: "2026-02-17", dedupeKey: "fed:fomc:2026-02-16", confidence: 1, sourceTier: 1 })]);
  });

  it("tags megacap theme at the 200e9 boundary", async () => {
    const earnings = { data: { rows: [
      { symbol: "ATB", name: "At Boundary Inc", marketCap: "$200,000,000,000", time: "time-pre-market" },
      { symbol: "UNDER", name: "Just Under Inc", marketCap: "$199,999,999,999", time: "time-pre-market" },
    ] } };
    const s = store();
    await syncCalendars(s as never, { ...opts, fetch: mockFetch(earnings) as unknown as typeof fetch });
    const themes = s.upsertCatalyst.mock.calls.map(([c]) => (c as { themes: string[] }).themes);
    expect(themes).toEqual([["megacap"], []]);
  });

  it("sources every earnings row from the nasdaq.com calendar (tier 2, no fabricated IR/EDGAR urls)", async () => {
    const earnings = { data: { rows: [
      { symbol: "LITE", name: "Lumentum Holdings", marketCap: "$100,000,000,000", time: "time-pre-market" },
      { symbol: "NVDA", name: "NVIDIA Corp", marketCap: "$3,000,000,000,000", time: "time-pre-market" },
    ] } };
    const s = store();
    await syncCalendars(s as never, { ...opts, fetch: mockFetch(earnings) as unknown as typeof fetch });
    const calls = s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst & { dedupeKey: string });
    // IR_SOURCES export stays for reference but is no longer used for stored sourceUrl.
    expect(IR_SOURCES.LITE).toBeTruthy();
    for (const c of calls) {
      expect(c.kind).toBe("earnings");
      expect(c.sourceUrl).toBe("https://www.nasdaq.com/market-activity/earnings?date=2026-02-12");
    }

    // End-to-end: the real store re-tiers the nasdaq.com URL to 2 (mock fetch answers every other backend).
    const real = await memoryStore();
    await syncCalendars(real, { ...opts, fetch: mockFetch(earnings) as unknown as typeof fetch });
    const rows = await real.client.execute("SELECT source_url, source_tier FROM catalysts WHERE kind = 'earnings'");
    expect(rows.rows).toHaveLength(2);
    for (const r of rows.rows) {
      expect(String(r.source_url)).toBe("https://www.nasdaq.com/market-activity/earnings?date=2026-02-12");
      expect(Number(r.source_tier)).toBe(2);
    }
  });

  it("tolerates null rows", async () => {
    const fetchImpl = mockFetch({ data: { rows: null } });
    const s = store();
    const counts = await syncCalendars(s as never, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(counts).toEqual({ earnings: 0, macro: 0 });
    expect(s.upsertCatalyst).not.toHaveBeenCalled();
  });

  it("logs per-request errors and never throws", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("boom"); });
    const s = store();
    const log = vi.fn();
    const counts = await syncCalendars(s as never, { ...opts, fetch: fetchImpl as unknown as typeof fetch, sleep: async () => {}, log });
    expect(counts).toEqual({ earnings: 0, macro: 0 });
    expect(log.mock.calls.length).toBeGreaterThan(0);
    expect(s.upsertCatalyst).not.toHaveBeenCalled();
  });
});
