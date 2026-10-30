import { describe, expect, it, vi } from "vitest";
import { ELECTIONS, FR_AGENCIES, syncElections, syncFederalRegister } from "../src/catalysts/federal-register.js";
import type { Catalyst } from "../src/types.js";

const res = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const BIS = "industry-and-security-bureau";
const FTC = "federal-trade-commission";

const store = () => ({ upsertCatalyst: vi.fn(async (c: unknown) => ({ ...(c as object) } as Catalyst)) });
const opts = { today: "2026-11-01", horizonDays: 14 };
const catalysts = (s: ReturnType<typeof store>) => s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst);

function mockFetch(bySlug: Record<string, unknown>, failingSlugs: string[] = []) {
  return vi.fn(async (url: string) => {
    for (const [slug, body] of Object.entries(bySlug)) {
      if (url.includes(`agencies][]=${slug}`)) return res(body, !failingSlugs.includes(slug));
    }
    return res({ results: [] });
  });
}

describe("syncFederalRegister", () => {
  it("fixture: effective_on in the past, abstract end date in window -> exactly one catalyst dated 2026-11-09", async () => {
    const fetchImpl = mockFetch({
      [BIS]: {
        results: [
          {
            title: "Suspension of Certain Export Controls",
            effective_on: "2025-11-10",
            publication_date: "2025-11-12",
            html_url: "https://www.federalregister.gov/d/2025-12345",
            abstract: "The suspension is set to end November 9, 2026, absent a future extension.",
            document_number: "2025-12345",
          },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    const rows = catalysts(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "BIS: ends — Suspension of Certain Export Controls",
      kind: "rule_effective",
      status: "scheduled",
      dateStart: "2026-11-09",
      dateEnd: "2026-11-09",
      datePrecision: "exact",
      confidence: 0.9,
      themes: ["semiconductor export controls"],
      affectedTickers: ["NVDA", "AMD", "AMAT", "LRCX", "KLAC", "ASML", "TSM", "MU"],
      sourceTier: 1,
      sourceUrl: "https://www.federalregister.gov/d/2025-12345",
      dedupeKey: "fr:2025-12345:2026-11-09",
    });
  });

  it("effective date within window -> plain title; future abstract date -> both; same date -> deduped", async () => {
    const fetchImpl = mockFetch({
      [BIS]: {
        results: [
          { title: "Future rule", effective_on: "2026-11-05", html_url: "https://x/1", abstract: "", document_number: "doc-1" },
          { title: "Dual rule", effective_on: "2026-11-06", html_url: "https://x/2", abstract: "ends November 9, 2026", document_number: "doc-2" },
          { title: "Dup rule", effective_on: "2026-11-07", html_url: "https://x/3", abstract: "expires November 7, 2026", document_number: "doc-3" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    const rows = catalysts(s);
    expect(rows.map((r) => [r.title, r.dateStart])).toEqual([
      ["Future rule", "2026-11-05"],
      ["Dual rule", "2026-11-06"],
      ["BIS: ends — Dual rule", "2026-11-09"],
      ["Dup rule", "2026-11-07"],
    ]);
    expect(rows.every((r) => r.dedupeKey.startsWith("fr:"))).toBe(true);
  });

  it("FCC: only spectrum/broadband/satellite/net-neutrality/merger rules are kept", async () => {
    const fetchImpl = mockFetch({
      "federal-communications-commission": {
        results: [
          { title: "Spectrum Sharing in the 6 GHz Band", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "fcc-1" },
          { title: "Radio Broadcasting Services; FM Translator", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "fcc-2" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Spectrum Sharing in the 6 GHz Band"]);
  });

  it("dates outside [today, today+horizon] are dropped", async () => {
    const fetchImpl = mockFetch({
      [FTC]: {
        results: [
          { title: "Past", effective_on: "2026-10-31", html_url: "u", abstract: "", document_number: "p" },
          { title: "Far", effective_on: "2026-11-16", html_url: "u", abstract: "", document_number: "f" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s)).toHaveLength(0);
  });

  it("per-agency errors are logged, never thrown; other agencies still sync", async () => {
    const fetchImpl = mockFetch(
      {
        [BIS]: {
          results: [{ title: "Good rule", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "g" }],
        },
        [FTC]: { results: [] },
      },
      [FTC],
    );
    const logs: string[] = [];
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch, log: (m) => logs.push(m) });
    expect(logs.some((m) => m.includes("federal register") && m.includes("HTTP 500"))).toBe(true);
    expect(logs.some((m) => m.includes(FTC))).toBe(true);
    expect(catalysts(s).map((r) => r.title)).toEqual(["Good rule"]);
  });
});

describe("syncElections", () => {
  it("injects the election only when it falls within the window", async () => {
    const inWindow = store();
    await syncElections(inWindow, { today: "2026-11-01", horizonDays: 14 });
    expect(catalysts(inWindow)).toEqual([
      {
        ticker: null,
        title: ELECTIONS[0]!.title,
        kind: "election",
        status: "confirmed",
        dateStart: "2026-11-03",
        dateEnd: "2026-11-03",
        datePrecision: "exact",
        confidence: 0.95,
        themes: ["policy"],
        affectedTickers: [],
        sourceTier: 1,
        sourceUrl: "https://www.usa.gov/midterm-state-and-local-elections",
        observationId: null,
        dedupeKey: "election:2026-11-03",
      },
    ]);
    const outOfWindow = store();
    await syncElections(outOfWindow, { today: "2026-02-12", horizonDays: 14 });
    expect(catalysts(outOfWindow)).toHaveLength(0);
  });
});

describe("FR_AGENCIES", () => {
  it("covers the four agency slugs", () => {
    expect(Object.keys(FR_AGENCIES)).toEqual([
      "industry-and-security-bureau",
      "trade-representative-office-of-united-states",
      "federal-trade-commission",
      "federal-communications-commission",
    ]);
  });
});
