import { describe, expect, it, vi } from "vitest";
import { ELECTIONS, FR_AGENCIES, keepCommentClose, syncElections, syncFederalRegister } from "../src/catalysts/federal-register.js";
import type { Catalyst } from "../src/types.js";

const res = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const BIS = "industry-and-security-bureau";
const FTC = "federal-trade-commission";

const store = () => ({
  upsertCatalyst: vi.fn(async (c: unknown) => ({ ...(c as object) } as Catalyst)),
  purgeStaleCatalysts: vi.fn(async (_kind: string, _from: string, _before: string, _keyPrefix: string) => 0),
});
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
            title: "Suspension of Export Controls on Affiliates of Entity List Companies",
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
      title: "BIS affiliates rule back in force Nov 10 (suspension ends Nov 9) — Suspension of Export Controls on Affiliates of Entity List Companies",
      kind: "rule_effective",
      status: "scheduled",
      dateStart: "2026-11-10",
      dateEnd: "2026-11-10",
      datePrecision: "exact",
      confidence: 0.9,
      themes: ["semiconductor export controls"],
      affectedTickers: ["NVDA", "AMD", "AMAT", "LRCX", "KLAC", "ASML", "TSM", "MU"],
      sourceTier: 1,
      sourceUrl: "https://www.federalregister.gov/d/2025-12345",
      dedupeKey: "fr:2025-12345:2026-11-10",
    });
  });

  it("effective date within window -> plain title; future abstract date -> both; same date -> deduped", async () => {
    const fetchImpl = mockFetch({
      [BIS]: {
        results: [
          { title: "Future semiconductor rule", effective_on: "2026-11-05", html_url: "https://x/1", abstract: "", document_number: "doc-1" },
          { title: "Dual rule on integrated circuits", effective_on: "2026-11-06", html_url: "https://x/2", abstract: "suspension ends November 9, 2026", document_number: "doc-2" },
          { title: "Dup rule for a foundry", effective_on: "2026-11-07", html_url: "https://x/3", abstract: "expires November 6, 2026", document_number: "doc-3" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    const rows = catalysts(s);
    expect(rows.map((r) => [r.title, r.dateStart])).toEqual([
      ["Future semiconductor rule", "2026-11-05"],
      ["Dual rule on integrated circuits", "2026-11-06"],
      ["BIS: rule back in force Nov 10 (suspension ends Nov 9) — Dual rule on integrated circuits", "2026-11-10"],
      ["Dup rule for a foundry", "2026-11-07"],
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

  it("BIS rules outside semiconductor topics (e.g. silencers, mufflers) are dropped entirely", async () => {
    const fetchImpl = mockFetch({
      [BIS]: {
        results: [
          {
            title: "Implementation of EAR Export Controls on Silencers, Mufflers",
            effective_on: "2026-11-05",
            html_url: "u",
            abstract: "",
            document_number: "sil-1",
          },
          { title: "Advanced computing chip rule", effective_on: "2026-11-06", html_url: "u", abstract: "", document_number: "chip-1" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Advanced computing chip rule"]);
  });

  it("per-agency errors are logged, never thrown; other agencies still sync", async () => {
    const fetchImpl = mockFetch(
      {
        [BIS]: {
          results: [{ title: "Good rule on entity list parties", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "g" }],
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
    expect(catalysts(s).map((r) => r.title)).toEqual(["Good rule on entity list parties"]);
    expect(s.purgeStaleCatalysts).not.toHaveBeenCalled();
  });

  it("purges stale rule + comment rows once all agencies succeed", async () => {
    const s = store();
    const started = new Date().toISOString();
    await syncFederalRegister(s, { ...opts, fetch: mockFetch({}) as unknown as typeof fetch });
    expect(s.purgeStaleCatalysts).toHaveBeenCalledTimes(2);
    const [kind, from, before, keyPrefix] = s.purgeStaleCatalysts.mock.calls[0]!;
    expect([kind, from, keyPrefix]).toEqual(["rule_effective", opts.today, "fr:"]);
    expect(before >= started && before <= new Date().toISOString()).toBe(true);
    expect(s.purgeStaleCatalysts.mock.calls[1]).toEqual(["regulatory_decision", opts.today, expect.any(String), "fr:"]);
  });
});

describe("federal register noise filters", () => {
  it("skips correction documents (C1-, C2-)", async () => {
    const fetchImpl = mockFetch({
      [FTC]: {
        results: [
          { title: "Merger Rule Corrections", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "C1-2026-11111" },
          { title: "Merger Rule", effective_on: "2026-11-06", html_url: "u", abstract: "", document_number: "2026-22222" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Merger Rule"]);
  });

  it("USTR 'Request for Comments ...' with a 'through' abstract gets no back-in-force event", async () => {
    const USTR = "trade-representative-office-of-united-states";
    const fetchImpl = mockFetch({
      [USTR]: {
        results: [
          {
            title: "Request for Comments on Tariff Exclusions",
            effective_on: null,
            html_url: "u",
            abstract: "The comment period runs through December 31, 2026.",
            document_number: "2026-33333",
          },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s)).toEqual([]);
  });

  it("keepCommentClose", () => {
    expect(keepCommentClose("SEC", "Transfer Agent Rules")).toBe(false);
    expect(keepCommentClose("SEC", "Proxy Solicitation Modernization")).toBe(true);
    expect(keepCommentClose("FTC", "Petition for Rulemaking of X")).toBe(false);
    expect(keepCommentClose("ITA", "Subsidy Programs on Softwood Lumber")).toBe(false);
    expect(keepCommentClose("ITA", "Section 232 Auto Parts Investigation")).toBe(true);
    expect(keepCommentClose("USTR", "Anything At All")).toBe(true);
    expect(keepCommentClose("FTC", "Merger Filing Requirements")).toBe(true);
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
  it("covers the seven agency slugs", () => {
    expect(Object.keys(FR_AGENCIES)).toEqual([
      "industry-and-security-bureau",
      "trade-representative-office-of-united-states",
      "federal-trade-commission",
      "federal-communications-commission",
      "international-trade-administration",
      "u-s-customs-and-border-protection",
      "securities-and-exchange-commission",
    ]);
  });
});

describe("trade agencies (USTR/ITA/CBP)", () => {
  it("keeps only trade-topic RULE/PRORULE/NOTICE docs; queries NOTICE type", async () => {
    const fetchImpl = mockFetch({
      "trade-representative-office-of-united-states": {
        results: [
          { title: "Request for Comments on Further Suspension of Section 301 Action", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "ustr-1" },
          { title: "Federal Advisory Committee Meeting", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "ustr-2" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Request for Comments on Further Suspension of Section 301 Action"]);
    const url = String(fetchImpl.mock.calls.find(([u]) => String(u).includes("trade-representative"))![0]);
    expect(url).toContain("conditions[type][]=RULE");
    expect(url).toContain("conditions[type][]=PRORULE");
    expect(url).toContain("conditions[type][]=NOTICE");
  });

  it("uses title+abstract for the trade filter", async () => {
    const fetchImpl = mockFetch({
      "u-s-customs-and-border-protection": {
        results: [
          { title: "Quarterly IRS Listing", effective_on: "2026-11-05", html_url: "u", abstract: "irrelevant", document_number: "cbp-1" },
          { title: "Extension of Import Restrictions Imposing Duties", effective_on: "2026-11-05", html_url: "u", abstract: "cultural antiquities", document_number: "cbp-2" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Extension of Import Restrictions Imposing Duties"]);
  });

  it("ITA drops routine review paperwork unless Section 232", async () => {
    const fetchImpl = mockFetch({
      "international-trade-administration": {
        results: [
          { title: "Initiation of Antidumping Administrative Review", effective_on: "2026-11-05", html_url: "u", abstract: "certain steel", document_number: "ita-1" },
          { title: "Section 232 Preliminary Results on Aluminum", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "ita-2" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Section 232 Preliminary Results on Aluminum"]);
  });
});

describe("SEC", () => {
  it("keeps RULE/PRORULE, drops housekeeping titles, does not query NOTICE", async () => {
    const fetchImpl = mockFetch({
      "securities-and-exchange-commission": {
        results: [
          { title: "Amendments to Regulation SBSR", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "sec-1" },
          { title: "Self-Regulatory Organizations; NYSE; Order Approving", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "sec-2" },
          { title: "Sunshine Act Meeting Notice", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "sec-3" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Amendments to Regulation SBSR"]);
    const url = String(fetchImpl.mock.calls.find(([u]) => String(u).includes("securities-and-exchange"))![0]);
    expect(url).not.toContain("NOTICE");
  });
});

describe("comments_close_on", () => {
  it("upserts an extra comments-close event in the window", async () => {
    const fetchImpl = mockFetch({
      "trade-representative-office-of-united-states": {
        results: [
          { title: "Section 301 Tariff Action on China", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "ustr-9", comments_close_on: "2026-11-12" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    const rows = catalysts(s);
    expect(rows.map((r) => [r.kind, r.title, r.dedupeKey])).toEqual([
      ["rule_effective", "Section 301 Tariff Action on China", "fr:ustr-9:2026-11-05"],
      ["regulatory_decision", "USTR comments close: Section 301 Tariff Action on China", "fr:ustr-9:comments:2026-11-12"],
    ]);
  });

  it("ignores comments_close_on outside the window or malformed", async () => {
    const fetchImpl = mockFetch({
      "trade-representative-office-of-united-states": {
        results: [
          { title: "Section 301 Tariff Action", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "ustr-10", comments_close_on: "2026-12-31" },
          { title: "Section 232 Steel Action", effective_on: "2026-11-06", html_url: "u", abstract: "", document_number: "ustr-11", comments_close_on: "soon" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).every((r) => r.kind === "rule_effective")).toBe(true);
  });
});
