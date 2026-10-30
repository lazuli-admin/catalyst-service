import { describe, expect, it, vi } from "vitest";
import { syncCalendars } from "../src/catalysts/calendars.js";
import type { Catalyst } from "../src/types.js";

const EARNINGS_URL = "https://api.nasdaq.com/api/calendar/earnings?date=";
const MACRO_URL = "https://api.nasdaq.com/api/calendar/economicevents?date=";

const res = (body: unknown) => ({ ok: true, json: async () => body });

function mockFetch(earnings: unknown, macro: unknown) {
  return vi.fn(async (url: string) => {
    if (!url.includes("date=2026-02-12")) return res({ data: { rows: null } });
    return url.startsWith(EARNINGS_URL) ? res(earnings) : url.startsWith(MACRO_URL) ? res(macro) : res({});
  });
}

const store = () => ({ upsertCatalyst: vi.fn(async (c: unknown) => ({ ...(c as object) } as Catalyst)) });

const opts = { from: "2026-02-12", days: 5, watchlist: ["smol"], minMarketCap: 50e9 };
// 2026-02-12 is a Thursday; 02-14/15 are Sat/Sun. Only Thursday returns data; other days return null rows.

describe("syncCalendars", () => {
  it("keeps watchlist small-cap, big-cap; drops small non-watchlist; keeps US CPI, drops Germany macro; skips weekend", async () => {
    const earnings = { data: { rows: [
      { symbol: "SMOL", name: "SmallCap Inc", marketCap: "$1,000,000", time: "time-pre-market" },
      { symbol: "BIGC", name: "BigCap Corp", marketCap: "$253,966,172,000", time: "time-after-hours" },
      { symbol: "TINY", name: "Tiny Ltd", marketCap: "$2,000,000", time: "time-not-supplied" },
    ] } };
    const macro = { data: { rows: [
      { gmt: "8:30am", country: "United States", eventName: "Consumer Price Index (CPI)" },
      { gmt: "8:30am", country: "Germany", eventName: "Consumer Price Index (CPI)" },
      { gmt: "10am", country: "United States", eventName: "Manufacturing Purchasing Managers Index" },
    ] } };
    const fetchImpl = mockFetch(earnings, macro);
    const s = store();
    const counts = await syncCalendars(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(counts).toEqual({ earnings: 2, macro: 1 });
    const titles = s.upsertCatalyst.mock.calls.map(([c]) => (c as { title: string }).title);
    expect(titles).toContain("SmallCap Inc earnings (bmo)");
    expect(titles).toContain("BigCap Corp earnings (amc)");
    expect(titles.some((t) => t.includes("Tiny Ltd"))).toBe(false);
    expect(titles).toContain("US CPI");
    expect(titles.filter((t) => t.includes("Germany")).length).toBe(0);
    expect(titles.some((t) => t.includes("Purchasing Managers"))).toBe(false);
    const tickers = s.upsertCatalyst.mock.calls.map(([c]) => (c as { ticker: string | null }).ticker);
    expect(tickers).toEqual(["SMOL", "BIGC", null]);
    // Mon-Fri = 3 fetch pairs (Sat/Sun skipped); watch for date correctness
    const urls = fetchImpl.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("date=2026-02-12"))).toBe(true);
    expect(urls.some((u) => u.includes("date=2026-02-14"))).toBe(false);
    expect(urls.some((u) => u.includes("date=2026-02-15"))).toBe(false);
    // dedupeKey set
    expect(s.upsertCatalyst.mock.calls.every(([c]) => typeof (c as { dedupeKey: string }).dedupeKey === "string" && (c as { dedupeKey: string }).dedupeKey.length > 0)).toBe(true);
  });

  it("collapses macro sub-series to one canonical catalyst per date", async () => {
    const macro = { data: { rows: [
      { gmt: "8:30am", country: "United States", eventName: "Consumer Price Index (CPI)" },
      { gmt: "8:30am", country: "United States", eventName: "Core CPI m/m" },
      { gmt: "8:30am", country: "United States", eventName: "CPI Index, n.s.a." },
      { gmt: "8:30am", country: "United States", eventName: "Cleveland CPI" },
      { gmt: "8:30am", country: "United States", eventName: "ISM Manufacturing PMI" },
      { gmt: "8:30am", country: "United States", eventName: "ISM Manufacturing New Orders" },
    ] } };
    const s = store();
    const counts = await syncCalendars(s, { ...opts, fetch: mockFetch({ data: { rows: null } }, macro) as unknown as typeof fetch });
    expect(counts).toEqual({ earnings: 0, macro: 2 });
    const rows = s.upsertCatalyst.mock.calls.map(([c]) => c as { title: string; dedupeKey: string });
    expect(rows.map((r) => r.title).sort()).toEqual(["US CPI", "US ISM Manufacturing"]);
    expect(rows.every((r) => r.dedupeKey === `macro:${r.title}:2026-02-12`)).toBe(true);
  });

  it("tolerates null rows", async () => {
    const fetchImpl = mockFetch({ data: { rows: null } }, { data: { rows: null } });
    const s = store();
    const counts = await syncCalendars(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(counts).toEqual({ earnings: 0, macro: 0 });
    expect(s.upsertCatalyst).not.toHaveBeenCalled();
  });

  it("logs per-request errors and never throws", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("boom"); });
    const s = store();
    const log = vi.fn();
    const counts = await syncCalendars(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch, log });
    expect(counts).toEqual({ earnings: 0, macro: 0 });
    expect(log.mock.calls.length).toBeGreaterThan(0);
    expect(s.upsertCatalyst).not.toHaveBeenCalled();
  });
});
