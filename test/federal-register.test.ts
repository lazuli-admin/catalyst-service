import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { catalystDensity } from "../src/catalysts/density.js";
import { ELECTIONS, FR_AGENCIES, getLastFrSyncReport, syncElections, syncFederalRegister } from "../src/catalysts/federal-register.js";
import { frDocNumbersFromEvents, syncPolicyEvents } from "../src/catalysts/policy.js";
import { memoryStore } from "./helpers.js";
import { isRelevant, topicTags } from "../src/topics.js";
import type { Catalyst } from "../src/types.js";

const res = (body: unknown, ok = true, status = ok ? 200 : 500, headers: Record<string, string> = {}) => ({
  ok,
  status,
  headers: { get: (name: string) => { const k = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase()); return k ? headers[k] : null; } },
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const BIS = "industry-and-security-bureau";
const FTC = "federal-trade-commission";

const store = () => ({
  upsertCatalyst: vi.fn(async (c: unknown) => ({ ...(c as object) } as Catalyst)),
  listStaleCatalysts: vi.fn(async (..._a: unknown[]): Promise<{ dedupeKey: string; title: string }[]> => []),
  purgeStaleCatalysts: vi.fn(async (_kind: string, _from: string, _before: string, _keyPrefix: string) => 0),
});
const opts = { today: "2026-11-01", horizonDays: 14, sleep: async () => {} };
const catalysts = (s: ReturnType<typeof store>) => s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst);

function mockFetch(bySlug: Record<string, unknown>, failingSlugs: string[] = []) {
  return vi.fn(async (url: string) => {
    // Raw-text fetches (presidential docs) return the plain text stored under "rawText".
    if (!url.includes("documents.json")) return res(bySlug.rawText ?? "", !failingSlugs.includes("rawText"));
    const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1);
    for (const [slug, body] of Object.entries(bySlug)) {
      if (slug === "rawText" || !url.includes(slug)) continue;
      if (typeof body === "function") {
        const out = (body as (p: number) => unknown)(page);
        // A function may return a pre-built response (e.g. res(x, false) for a 500).
        if (out && typeof out === "object" && "ok" in (out as object)) return out as ReturnType<typeof res>;
        return res(out, !failingSlugs.includes(slug));
      }
      // A body without total_pages describes page 1 only; later pages are empty.
      if (page >= 2) return res({ results: [] }, !failingSlugs.includes(slug));
      return res(body, !failingSlugs.includes(slug));
    }
    // PRESDOCU (and anything else unmatched) returns an empty result set by default.
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
      datePrecision: "estimated",
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
      ["Dup rule for a foundry", "2026-11-06"],
    ]);
    expect(rows.every((r) => r.dedupeKey.startsWith("fr:"))).toBe(true);
    const abstractRow = rows[rows.length - 1]!;
    expect(abstractRow.datePrecision).toBe("estimated");
    const apiRow = rows.find((r) => r.dateStart === "2026-11-07");
    expect(apiRow?.datePrecision).toBe("exact");
    expect(apiRow?.dateSource).toBe("api");
    expect(abstractRow.dateSource).toBe("text");
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

  it("proposed rule: effective_on becomes the initial comment deadline, no rule_effective row", async () => {
    const fetchImpl = mockFetch({
      "federal-communications-commission": {
        results: [
          {
            title: "Spectrum Sharing in the 6 GHz Band",
            type: "Proposed Rule",
            effective_on: "2026-11-09",
            html_url: "u",
            abstract: "",
            document_number: "fcc-prop-1",
            comments_close_on: "2026-12-07",
          },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    const rows = catalysts(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "comment_close",
      dateStart: "2026-11-09",
      dateEnd: "2026-11-09",
      dedupeKey: "fr:fcc-prop-1:comments:2026-11-09",
    });
    expect(rows[0]!.title).toContain("(replies Dec 7)");
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
    expect(s.purgeStaleCatalysts).toHaveBeenCalledTimes(4);
    const [kind, from, before, keyPrefix] = s.purgeStaleCatalysts.mock.calls[0]!;
    expect([kind, from, keyPrefix]).toEqual(["rule_effective", opts.today, "fr:"]);
    expect(before >= started && before <= new Date().toISOString()).toBe(true);
    expect(s.purgeStaleCatalysts.mock.calls[1]).toEqual(["comment_close", opts.today, expect.any(String), "fr:"]);
    expect(s.purgeStaleCatalysts.mock.calls[2]).toEqual(["presidential_action", opts.today, expect.any(String), "fr:"]);
    expect(s.purgeStaleCatalysts.mock.calls[3]).toEqual(["regulatory_decision", opts.today, expect.any(String), "fr:"]);
  });

  it("reports stale rows it purges: fetched doc with no topic match -> 'no topic match'", async () => {
    const fetchImpl = mockFetch({
      [BIS]: {
        results: [
          { title: "Rules of Practice for Hearings", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "2099-00001" },
        ],
      },
    });
    const logs: string[] = [];
    const s = store();
    s.listStaleCatalysts.mockImplementation(async (kind: unknown) =>
      kind === "rule_effective" ? [{ dedupeKey: "fr:2099-00001:2026-12-01", title: "Old rule" }] : [],
    );
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch, log: (m) => logs.push(m) });
    const report = getLastFrSyncReport();
    expect(report).not.toBeNull();
    expect(report!.drops).toEqual([{ dedupeKey: "fr:2099-00001:2026-12-01", title: "Old rule", reason: "no topic match" }]);
    expect(report!.count).toBe(1); // count is now drops.length
    expect(logs).toContainEqual("federal register drop fr:2099-00001:2026-12-01 (no topic match): Old rule");
  });

  it("reports stale rows it purges: doc absent from the fetch -> 'source missing'", async () => {
    const s = store();
    s.listStaleCatalysts.mockImplementation(async (kind: unknown) =>
      kind === "regulatory_decision" ? [{ dedupeKey: "fr:2099-00002:comments:2026-12-02", title: "Gone rule" }] : [],
    );
    await syncFederalRegister(s, { ...opts, fetch: mockFetch({}) as unknown as typeof fetch });
    expect(getLastFrSyncReport()!.drops).toEqual([
      { dedupeKey: "fr:2099-00002:comments:2026-12-02", title: "Gone rule", reason: "source missing" },
    ]);
  });
});

describe("federal register noise filters", () => {
  it("skips correction documents (C1-, C2-)", async () => {
    const fetchImpl = mockFetch({
      [FTC]: {
        results: [
          { title: "Merger Rule Corrections", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "C1-2026-11111" },
          { title: "Merger Rule for Pharmaceutical Companies", effective_on: "2026-11-06", html_url: "u", abstract: "", document_number: "2026-22222" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Merger Rule for Pharmaceutical Companies"]);
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

  it("isRelevant drops routine noise and keeps topic titles", () => {
    expect(isRelevant({ title: "Transfer Agent Rules" })).toBe(false);
    expect(isRelevant({ title: "Proxy Solicitation Modernization" })).toBe(true);
    expect(isRelevant({ title: "Petition for Rulemaking of X" })).toBe(false);
    expect(isRelevant({ title: "Subsidy Programs on Softwood Lumber" })).toBe(true);
    expect(isRelevant({ title: "Section 232 Auto Parts Investigation" })).toBe(true);
    expect(isRelevant({ title: "Anything At All" })).toBe(false);
    expect(isRelevant({ title: "Merger Filing Requirements" })).toBe(false);
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
          { title: "Extension of Import Restrictions Imposing Duties on Steel Tariffs", effective_on: "2026-11-05", html_url: "u", abstract: "cultural antiquities", document_number: "cbp-2" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Extension of Import Restrictions Imposing Duties on Steel Tariffs"]);
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
  it("keeps topic titles, drops housekeeping titles, and its URL includes conditions[type][]=NOTICE", async () => {
    const fetchImpl = mockFetch({
      "securities-and-exchange-commission": {
        results: [
          { title: "Amendments to Regulation SBSR for Shareholder Proposals", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "sec-1" },
          { title: "Self-Regulatory Organizations; NYSE; Order Approving", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "sec-2" },
          { title: "Sunshine Act Meeting Notice", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "sec-3" },
        ],
      },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.title)).toEqual(["Amendments to Regulation SBSR for Shareholder Proposals"]);
    const url = String(fetchImpl.mock.calls.find(([u]) => String(u).includes("securities-and-exchange"))![0]);
    expect(url).toContain("conditions[type][]=NOTICE");
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
      ["comment_close", "USTR comments close: Section 301 Tariff Action on China", "fr:ustr-9:comments:2026-11-12"],
    ]);
  });

  it("topic assignment is invariant to agency", () => {
    const agencyLabels = [...Object.values(FR_AGENCIES).map((a) => a.label), "President"];
    const docs = [
      { title: "Advanced computing chip rule", abstract: "", documentNumber: "chip-1" },
      { title: "Spectrum Sharing in the 6 GHz Band", abstract: "", documentNumber: "fcc-1" },
      { title: "Section 301 Tariff Action on China", abstract: "", documentNumber: "ustr-9" },
    ];
    for (const doc of docs) {
      const baseTags = topicTags({ ...doc, agency: agencyLabels[0] });
      const baseRelevant = isRelevant({ ...doc, agency: agencyLabels[0] });
      expect(baseRelevant).toBe(true);
      expect(baseTags.topics.length).toBeGreaterThan(0);
      for (const agency of agencyLabels.slice(1)) {
        expect(topicTags({ ...doc, agency })).toEqual(baseTags);
        expect(isRelevant({ ...doc, agency })).toBe(baseRelevant);
      }
    }
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

describe("federal register paging and PRESDOCU", () => {
  it("multi-page: page 1 and page 2 docs are both upserted, purge runs, report complete, query pages 2", async () => {
    const fetchImpl = mockFetch({
      [BIS]: (page: number) =>
        page === 1
          ? {
              results: [{ title: "Advanced computing chip rule", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "mp-1" }],
              total_pages: 2,
            }
          : {
              results: [{ title: "Advanced computing chip rule II", effective_on: "2026-11-06", html_url: "u", abstract: "", document_number: "mp-2" }],
            },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    const rows = catalysts(s);
    expect(rows.map((r) => r.dedupeKey)).toEqual(["fr:mp-1:2026-11-05", "fr:mp-2:2026-11-06"]);
    expect(s.purgeStaleCatalysts).toHaveBeenCalledTimes(4);
    const report = getLastFrSyncReport();
    expect(report!.complete).toBe(true);
    const bis = report!.queries.find((q) => q.name === "BIS");
    expect(bis).toMatchObject({ pages: 2, totalPages: 2, ok: true });
  });

  it("mid-paging failure: page-1 doc is kept, no purge, report complete false with query error", async () => {
    const fetchImpl = mockFetch({
      [BIS]: (page: number) =>
        page === 1
          ? {
              results: [{ title: "Advanced computing chip rule", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "mf-1" }],
              total_pages: 2,
            }
          : res({}, false),
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.dedupeKey)).toEqual(["fr:mf-1:2026-11-05"]);
    expect(s.purgeStaleCatalysts).not.toHaveBeenCalled();
    expect(s.listStaleCatalysts).not.toHaveBeenCalled();
    const report = getLastFrSyncReport();
    expect(report!.complete).toBe(false);
    expect(report!.count).toBe(0);
    expect(report!.drops).toEqual([]);
    // pages counts successfully fetched pages; page 2 failed before being counted.
    expect(report!.queries.find((q) => q.name === "BIS")).toMatchObject({ ok: false, pages: 1, totalPages: 2, error: "HTTP 500" });
  });

  it("page cap: total_pages 25 stops at the cap with 'page cap exceeded', no purge", async () => {
    // Every page carries a result (an empty page would end the loop before the cap check).
    const doc = { title: "Advanced computing chip rule", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "cap-1" };
    const fetchImpl = mockFetch({
      [BIS]: (page: number) => (page === 1 ? { results: [doc], total_pages: 25 } : { results: [doc] }),
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(s.upsertCatalyst).toHaveBeenCalledTimes(20);
    expect(s.purgeStaleCatalysts).not.toHaveBeenCalled();
    const report = getLastFrSyncReport();
    expect(report!.complete).toBe(false);
    expect(report!.queries.find((q) => q.name === "BIS")).toMatchObject({ ok: false, error: "page cap exceeded" });
    expect(report!.queries.find((q) => q.name === "BIS")).toMatchObject({ pages: 20 });
  });

  it("PRESDOCU: proclamation with a raw-text midnight clause becomes a presidential_action row", async () => {
    const fetchImpl = mockFetch({
      PRESDOCU: {
        results: [
          {
            title: "Adjusting Imports of Steel Into the United States Under Section 232",
            type: "Presidential Document",
            subtype: "Proclamation",
            effective_on: null,
            html_url: "https://www.federalregister.gov/d/2026-26301",
            abstract: "",
            document_number: "2026-26301",
            raw_text_url: "https://www.federalregister.gov/documents/full_text/raw/2026-26301.txt",
          },
        ],
        total_pages: 1,
      },
      rawText: "Adjusted imports of steel shall apply on or after 12:01 a.m. eastern time on December 4, 2026.",
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, horizonDays: 60, fetch: fetchImpl as unknown as typeof fetch });
    const rows = catalysts(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "presidential_action",
      dateStart: "2026-12-04",
      dateEnd: "2026-12-04",
      datePrecision: "estimated",
      status: "scheduled",
      sourceUrl: "https://www.federalregister.gov/d/2026-26301",
      dedupeKey: "fr:2026-26301:2026-12-04",
    });
    expect(rows[0]!.title).toMatch(/^Proclamation in effect Dec 4:/);
    expect(getLastFrSyncReport()!.complete).toBe(true);
    expect(getLastFrSyncReport()!.queries.find((q) => q.name === "PRESDOCU")).toMatchObject({ pages: 1, ok: true });
    expect(s.purgeStaleCatalysts).toHaveBeenCalledTimes(4);
  });

  it("PRESDOCU: raw-text fetch failing (500) -> no purge, report complete false", async () => {
    const fetchImpl = mockFetch(
      {
        PRESDOCU: {
          results: [
            {
              title: "Adjusting Imports of Steel Into the United States Under Section 232",
              type: "Presidential Document",
              subtype: "Proclamation",
              effective_on: null,
              html_url: "https://www.federalregister.gov/d/2026-26301",
              abstract: "",
              document_number: "2026-26301",
              raw_text_url: "https://www.federalregister.gov/documents/full_text/raw/2026-26301.txt",
            },
          ],
          total_pages: 1,
        },
        rawText: "on or after 12:01 a.m. eastern time on December 4, 2026",
      },
      ["rawText"],
    );
    const s = store();
    await syncFederalRegister(s, { ...opts, horizonDays: 60, fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s)).toHaveLength(0);
    expect(s.purgeStaleCatalysts).not.toHaveBeenCalled();
    const report = getLastFrSyncReport();
    expect(report!.complete).toBe(false);
    expect(report!.queries.find((q) => q.name === "PRESDOCU")).toMatchObject({ ok: false, error: "HTTP 500" });
  });
});

describe("curated FR doc number skipping", () => {
  const polysiliconDoc = {
    title: "Adjusting Imports of Polysilicon and Its Derivatives Into the United States Under Section 232",
    type: "Presidential Document",
    subtype: "Proclamation",
    effective_on: null,
    html_url: "https://www.federalregister.gov/documents/2026/08/11/2026-16400/adjusting-imports-of-polysilicon-and-its-derivatives-into-the-united-states",
    abstract: "",
    document_number: "2026-16400",
    raw_text_url: "https://www.federalregister.gov/documents/full_text/raw/2026-16400.txt",
  };
  const proclamationText =
    "do hereby proclaim as follows: (1) Effective with respect to goods entered on or after 12:01 a.m. eastern time on December 4, 2026, imports of polysilicon shall be subject to minimum import prices plus a 15% duty.";

  it("skips a curated doc: no upsert, skippedCurated reported, pre-existing fr row purged as curated duplicate", async () => {
    const fetchImpl = mockFetch({ PRESDOCU: { results: [polysiliconDoc], total_pages: 1 }, rawText: proclamationText });
    const s = store();
    s.listStaleCatalysts.mockImplementation(async (kind: string) =>
      kind === "presidential_action"
        ? [{ dedupeKey: "fr:2026-16400:2026-12-04", title: "Proclamation in effect Dec 4: Adjusting Imports of Polysilicon" }]
        : [],
    );
    await syncFederalRegister(s, { ...opts, horizonDays: 60, fetch: fetchImpl as unknown as typeof fetch, curatedDocNumbers: new Set(["2026-16400"]) });
    expect(catalysts(s)).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalledWith(polysiliconDoc.raw_text_url);
    const report = getLastFrSyncReport();
    expect(report!.complete).toBe(true);
    expect(report!.skippedCurated).toEqual(["2026-16400"]);
    expect(report!.drops).toEqual([
      { dedupeKey: "fr:2026-16400:2026-12-04", title: "Proclamation in effect Dec 4: Adjusting Imports of Polysilicon", reason: "curated duplicate" },
    ]);
  });

  it("FSLR double count: curated policy row + skipped FR doc -> exactly ONE Dec 4 item for FSLR, no cluster bonus", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fr-curated-"));
    const file = path.join(dir, "policy-events.json");
    const event = {
      id: "s232-polysilicon-effective",
      date: "2026-12-04",
      dateEnd: "2026-12-04",
      precision: "exact",
      title: "Section 232 polysilicon: minimum import prices plus 15% duty take effect 12:01 a.m. ET (Proclamation, FR 2026-16400)",
      kind: "rule_effective",
      sourceUrl: "https://www.federalregister.gov/documents/2026/08/11/2026-16400/adjusting-imports-of-polysilicon-and-its-derivatives-into-the-united-states",
      themes: ["solar", "polysilicon", "Section 232"],
      affectedTickers: ["FSLR"],
    };
    await writeFile(file, JSON.stringify({ events: [event] }), "utf8");
    try {
      const s = await memoryStore();
      const today = "2026-12-01";
      await syncPolicyEvents(s, { today, horizonDays: 10, file });
      const fetchImpl = mockFetch({ PRESDOCU: { results: [polysiliconDoc], total_pages: 1 }, rawText: proclamationText });
      await syncFederalRegister(s, {
        today,
        horizonDays: 10,
        fetch: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
        curatedDocNumbers: frDocNumbersFromEvents([event]),
      });
      const cats = await s.listCatalysts({ from: "2026-12-04", to: "2026-12-04", includeLeads: true });
      const fslr = catalystDensity(cats, { asOf: today }).find((t) => t.ticker === "FSLR");
      expect(fslr).toBeDefined();
      // Exactly one Dec 4 item (the curated policy row) — the FR row was skipped, so no multi-kind cluster bonus.
      expect(fslr!.items).toHaveLength(1);
      expect(fslr!.items[0]!.catalyst.dedupeKey).toBe("policy:s232-polysilicon-effective");
      expect(fslr!.clusters).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("FR result cap, empty-page guard, and bounded retry", () => {
  const doc = { title: "Advanced computing chip rule", effective_on: "2026-11-05", html_url: "u", abstract: "", document_number: "rt-1" };

  // Fetch mock that returns a per-slug sequence of responses, one per attempt on that slug's URLs.
  function perSlugAttempt(handlers: Record<string, (attempt: number, url: string) => unknown>) {
    const attempts = new Map<string, number>();
    return vi.fn(async (url: string) => {
      const slug = Object.keys(handlers).find((s) => url.includes(s));
      if (!slug) return res({ results: [] });
      const n = (attempts.get(slug) ?? 0) + 1;
      attempts.set(slug, n);
      return handlers[slug]!(n, url);
    });
  }

  function recordingSleep() {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    return { sleep, delays };
  }

  const bisCalls = (fetchImpl: ReturnType<typeof perSlugAttempt>) =>
    fetchImpl.mock.calls.filter(([u]) => String(u).includes(BIS)).length;

  it("count >= 10000 on a query -> query ok:false with 'result cap', complete false, stale fr row NOT purged", async () => {
    const fetchImpl = perSlugAttempt({ [BIS]: () => res({ results: [], count: 10000 }) });
    const s = store();
    s.listStaleCatalysts.mockResolvedValue([{ dedupeKey: "fr:stale-1:2026-12-01", title: "Stale row" }]);
    const { sleep } = recordingSleep();
    await syncFederalRegister(s, { ...opts, sleep, curatedDocNumbers: new Set(), fetch: fetchImpl as unknown as typeof fetch });
    const report = getLastFrSyncReport();
    expect(report!.complete).toBe(false);
    expect(report!.queries.find((q) => q.name === "BIS")).toMatchObject({ ok: false, error: "result cap: count 10000 >= 10000" });
    expect(s.listStaleCatalysts).not.toHaveBeenCalled();
    expect(s.purgeStaleCatalysts).not.toHaveBeenCalled();
  });

  it("empty page before total_pages (total_pages 3, page 2 empty) -> ok:false 'empty page 2 of 3', complete false, no purge", async () => {
    const fetchImpl = mockFetch({
      [BIS]: (page: number) =>
        page === 1 ? { results: [{ ...doc, document_number: "ep-1" }], total_pages: 3 } : { results: [] },
    });
    const s = store();
    await syncFederalRegister(s, { ...opts, sleep: async () => {}, curatedDocNumbers: new Set(), fetch: fetchImpl as unknown as typeof fetch });
    const report = getLastFrSyncReport();
    expect(report!.complete).toBe(false);
    expect(report!.queries.find((q) => q.name === "BIS")).toMatchObject({ ok: false, error: "empty page 2 of 3" });
    expect(s.purgeStaleCatalysts).not.toHaveBeenCalled();
  });

  it("empty first page with total_pages 0 -> normal complete end, purge runs", async () => {
    const fetchImpl = mockFetch({ [BIS]: { results: [], total_pages: 0 } });
    const s = store();
    await syncFederalRegister(s, { ...opts, sleep: async () => {}, curatedDocNumbers: new Set(), fetch: fetchImpl as unknown as typeof fetch });
    expect(getLastFrSyncReport()!.complete).toBe(true);
    expect(s.purgeStaleCatalysts).toHaveBeenCalledTimes(4);
  });

  it("429 with Retry-After: 2 then 200 -> succeeds, sleep called with 2000 plus politeness delays, 2 fetch calls", async () => {
    const fetchImpl = perSlugAttempt({
      // Page 1: 429 then 200; total_pages 1 stops paging there.
      [BIS]: (attempt, url) => /[?&]page=([2-9]|\d+)/.exec(url)![1] !== "1" ? res({ results: [] }) : attempt === 1 ? res({ results: [] }, false, 429, { "Retry-After": "2" }) : res({ results: [doc], total_pages: 1 }),
    });
    const s = store();
    const { sleep, delays } = recordingSleep();
    await syncFederalRegister(s, { ...opts, sleep, curatedDocNumbers: new Set(), fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.dedupeKey)).toEqual(["fr:rt-1:2026-11-05"]);
    expect(getLastFrSyncReport()!.complete).toBe(true);
    expect(bisCalls(fetchImpl)).toBe(2);
    expect(delays[0]).toBe(2000);
    // Only the 2000ms retry delay and normal 250ms politeness delays remain.
    expect(delays.every((d) => d === 2000 || d === 250)).toBe(true);
    expect(delays.filter((d) => d === 2000)).toHaveLength(1);
  });

  it("503, 503, 200 -> succeeds with exponential backoff delays 1000 and 2000", async () => {
    const fetchImpl = perSlugAttempt({
      // Page 1: 503, 503, then 200; total_pages 1 stops paging there.
      [BIS]: (attempt, url) => /[?&]page=([2-9]|\d+)/.exec(url)![1] !== "1" ? res({ results: [] }) : attempt <= 2 ? res({ results: [] }, false, 503) : res({ results: [doc], total_pages: 1 }),
    });
    const s = store();
    const { sleep, delays } = recordingSleep();
    await syncFederalRegister(s, { ...opts, sleep, curatedDocNumbers: new Set(), fetch: fetchImpl as unknown as typeof fetch });
    expect(catalysts(s).map((r) => r.dedupeKey)).toEqual(["fr:rt-1:2026-11-05"]);
    expect(getLastFrSyncReport()!.complete).toBe(true);
    expect(bisCalls(fetchImpl)).toBe(3);
    expect(delays.slice(0, 2)).toEqual([1000, 2000]);
  });

  it("500 three times -> query ok:false with 'HTTP 500' after exactly 3 attempts", async () => {
    const fetchImpl = perSlugAttempt({ [BIS]: () => res({ results: [] }, false, 500) });
    const s = store();
    const { sleep, delays } = recordingSleep();
    await syncFederalRegister(s, { ...opts, sleep, curatedDocNumbers: new Set(), fetch: fetchImpl as unknown as typeof fetch });
    const report = getLastFrSyncReport();
    expect(report!.complete).toBe(false);
    expect(report!.queries.find((q) => q.name === "BIS")).toMatchObject({ ok: false, error: "HTTP 500" });
    expect(bisCalls(fetchImpl)).toBe(3);
    expect(delays.slice(0, 2)).toEqual([1000, 2000]);
  });

  it("404 -> no retry (1 attempt), query ok:false with 'HTTP 404'", async () => {
    const fetchImpl = perSlugAttempt({ [BIS]: () => res({ results: [] }, false, 404) });
    const s = store();
    const { sleep, delays } = recordingSleep();
    await syncFederalRegister(s, { ...opts, sleep, curatedDocNumbers: new Set(), fetch: fetchImpl as unknown as typeof fetch });
    const report = getLastFrSyncReport();
    expect(report!.complete).toBe(false);
    expect(report!.queries.find((q) => q.name === "BIS")).toMatchObject({ ok: false, error: "HTTP 404" });
    expect(bisCalls(fetchImpl)).toBe(1);
    expect(delays.every((d) => d === 250)).toBe(true);
  });
});
