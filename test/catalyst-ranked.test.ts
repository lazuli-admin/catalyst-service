import { describe, expect, it } from "vitest";
import { normalizeCompany, rankCatalysts } from "../src/catalysts/ranked.js";
import type { Catalyst } from "../src/types.js";

const TODAY = "2026-03-01";

function cat(overrides: Partial<Catalyst> = {}): Catalyst {
  return {
    id: "c",
    ticker: "NVDA",
    title: "Earnings call",
    kind: "earnings",
    status: "scheduled",
    dateStart: "2026-03-20",
    dateEnd: "2026-03-20",
    datePrecision: "exact",
    confidence: 1,
    sourceTier: 1,
    themes: [],
    affectedTickers: [],
    sourceUrl: null,
    impactWeight: null,
    observationId: null,
    dedupeKey: "k",
    createdAt: TODAY,
    updatedAt: TODAY,
    ...overrides,
  };
}

describe("rankCatalysts", () => {
  it("scores weight x certainty x confidence (no lead-time multiplier) and sorts by score desc then date", () => {
    const rows = rankCatalysts(
      [cat({ id: "a" }), cat({ id: "b", ticker: "AMD", title: "AMD earnings (Q1)", dateStart: "2026-03-20", dateEnd: "2026-03-24", datePrecision: "window", confidence: 0.5 }), cat({ id: "c", kind: "regulatory_decision" })],
      { asOf: TODAY, watchlist: [] },
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(rows[1]!.score).toBeCloseTo(3 * 1 * 1);
    expect(rows[2]!.score).toBeCloseTo(3 * 0.7 * 0.5);
    expect(rows[1]!.bucket).toBe("actionable"); // kept for API compatibility only
  });

  it("default view excludes leads, cancelled, done, past, low-weight kinds and imprecise dates", () => {
    const rows = rankCatalysts(
      [
        cat({ status: "lead" }),
        cat({ status: "cancelled" }),
        cat({ status: "done" }),
        cat({ dateStart: "2026-02-20", dateEnd: "2026-02-21" }),
        cat({ kind: "conference" }),
        cat({ datePrecision: "estimated" }),
        cat({ datePrecision: "window", dateEnd: "2026-04-10" }),
        cat({ id: "keep", ticker: null, kind: "macro" }),
      ],
      { asOf: TODAY, watchlist: [] },
    );
    expect(rows).toHaveLength(0);
    expect(rankCatalysts([cat({ id: "keep", ticker: null, kind: "macro" })], { asOf: TODAY, all: true })).toHaveLength(1);
  });

  it("focus watchlist tickers get score x2 and focus: true (ticker or affectedTicker)", () => {
    const docu = { ticker: null, affectedTickers: ["DOCN"], title: "Docusign earnings (Q2)" };
    const plain = rankCatalysts([cat({ ticker: "SMOL" }), cat(docu)], { asOf: TODAY, watchlist: [] });
    expect(plain.every((r) => !r.focus)).toBe(true);
    const rows = rankCatalysts([cat({ ticker: "SMOL" }), cat(docu)], { asOf: TODAY });
    const focused = rows.filter((r) => r.focus);
    expect(focused.map((r) => r.ticker ?? r.affectedTickers[0])).toEqual(["DOCN"]);
    expect(focused[0]!.score).toBeCloseTo(rows.find((r) => !r.focus)!.score * 2);
  });

  it("pinned macro and elections ride in the default view; other macro stays out", () => {
    const rows = rankCatalysts(
      [
        cat({ ticker: null, kind: "macro", title: "US CPI release" }),
        cat({ ticker: null, kind: "macro", title: "US Retail Sales" }),
        cat({ ticker: null, kind: "election", title: "US midterm elections" }),
      ],
      { asOf: TODAY, watchlist: [] },
    );
    expect(rows.map((r) => r.title).sort()).toEqual(["US CPI release", "US midterm elections"]);
    expect(rows.every((r) => r.pinned)).toBe(true);
  });

  it("pinned macro and elections get weight 3 then x2 boost; off-watchlist earnings stay at 3", () => {
    const rows = rankCatalysts(
      [
        cat({ ticker: null, kind: "macro", title: "US CPI: October inflation print", dateStart: "2026-03-25" }),
        cat({ ticker: null, kind: "macro", title: "US Jobs report: payrolls", dateStart: "2026-03-25" }),
        cat({ ticker: null, kind: "macro", title: "US PPI: producer prices", dateStart: "2026-03-25" }),
        cat({ ticker: "SMOL", title: "Off-watchlist earnings", dateStart: "2026-03-25" }),
      ],
      { asOf: TODAY, watchlist: [], all: true },
    );
    const by = new Map(rows.map((r) => [r.title, r.score]));
    expect(by.get("US CPI: October inflation print")).toBeCloseTo(6);
    expect(by.get("US Jobs report: payrolls")).toBeCloseTo(6);
    expect(by.get("US PPI: producer prices")).toBeCloseTo(1); // not pinned, weight 1
    expect(by.get("Off-watchlist earnings")).toBeCloseTo(3);
  });

  it("elections are pinned with weight 3 like macro and rank right after macro at equal score", () => {
    const rows = rankCatalysts(
      [
        cat({ ticker: null, kind: "election", title: "US midterm elections", dateStart: "2026-03-25" }),
        cat({ ticker: null, kind: "macro", title: "US CPI: October inflation print", dateStart: "2026-03-25" }),
        cat({ ticker: null, kind: "macro", title: "US Retail Sales", dateStart: "2026-03-25" }),
      ],
      { asOf: TODAY, watchlist: [], all: true },
    );
    const by = new Map(rows.map((r) => [r.title, r.score]));
    expect(by.get("US midterm elections")).toBeCloseTo(6); // same as pinned macro
    expect(rows.map((r) => r.title)).toEqual(["US CPI: October inflation print", "US midterm elections", "US Retail Sales"]);
  });

  it("collapses class-share earnings (BRK.A/BRK.B, FOXA/FOX) by date+normalized company name, keeping the higher score (ties: alphabetically last ticker)", () => {
    const rows = rankCatalysts(
      [
        cat({ id: "a1", ticker: "BRK.A", title: "Berkshire Hathaway Inc. earnings (Q1 2026)", dateStart: "2026-03-25" }),
        cat({ id: "b1", ticker: "BRK.B", title: "Berkshire Hathaway Inc. earnings (Q1 2026)", dateStart: "2026-03-25" }),
        cat({ id: "f1", ticker: "FOX", title: "Fox Corporation earnings (Q4 2026)", dateStart: "2026-03-25", confidence: 0.5 }),
        cat({ id: "fa1", ticker: "FOXA", title: "Fox Corporation earnings (Q4 2026)", dateStart: "2026-03-25" }),
        cat({ id: "a2", ticker: "BRK.A", title: "Berkshire Hathaway Inc. earnings (Q1 2026)", dateStart: "2026-03-26" }),
        cat({ id: "x1", ticker: "MSFT", title: "Microsoft earnings (FY26 Q3)", dateStart: "2026-03-25" }),
      ],
      { asOf: TODAY, watchlist: [], all: true },
    );
    // BRK.B kept over equal-score BRK.A (alphabetically last); FOXA kept over lower-score FOX; other dates/companies untouched
    expect(rows.map((r) => r.id)).toEqual(["b1", "fa1", "x1", "a2"]);
  });

  it("normalizeCompany strips earnings parens, punctuation and corporate/class suffixes", () => {
    expect(normalizeCompany("Berkshire Hathaway Inc. earnings (Q1 2026)")).toBe("berkshire hathaway");
    expect(normalizeCompany("Fox Corporation Class A earnings (Q4)")).toBe("fox");
    expect(normalizeCompany("Liberty Media Corp - Liberty SiriusXM Series A earnings (Q3)")).toBe("liberty media corp liberty siriusxm");
    expect(normalizeCompany("Nvidia earnings (Q3)")).toBe("nvidia");
  });

  it("focus earnings and pinned macro rank above off-watchlist earnings regardless of days out", () => {
    const rows = rankCatalysts(
      [
        cat({ id: "off-now", ticker: "SMOL", dateStart: "2026-03-02" }),
        cat({ id: "off-far", ticker: "SMOL2", title: "Otherco earnings (Q2)", dateStart: "2026-05-20" }),
        cat({ id: "focus-far", ticker: "NVDA", dateStart: "2026-05-20" }),
        cat({ id: "cpi-far", ticker: null, kind: "macro", title: "US CPI: May", dateStart: "2026-05-20" }),
        cat({ id: "jolts-far", ticker: null, kind: "macro", title: "US JOLTS: openings", dateStart: "2026-05-20" }),
      ],
      { asOf: TODAY, watchlist: ["NVDA"] },
    );
    // kind tie-break: macro sorts before earnings at equal score
    expect(rows.map((r) => r.id)).toEqual(["cpi-far", "jolts-far", "focus-far", "off-now", "off-far"]);
    expect(rows[0]!.score).toBeCloseTo(6);
  });

  it("implied move scales earnings score by clamp(im/0.05, 0.5, 3)", () => {
    const base = rankCatalysts([cat({ ticker: "NVDA" })], { asOf: TODAY, watchlist: [] })[0]!.score;
    const mv = rankCatalysts(
      [
        cat({ ticker: "NVDA" }),
        cat({ ticker: "SMOL", id: "s1", title: "Smoltech earnings (Q1)" }),
        cat({ ticker: "AAPL", id: "s2", title: "Apple earnings (FY26 Q2)" }),
      ],
      { asOf: TODAY, watchlist: [], impliedMove: { NVDA: 0.08, SMOL: 0.001, AAPL: 0.5 } },
    );
    const byTicker = new Map(mv.map((r) => [r.ticker, r]));
    const n = byTicker.get("NVDA")!;
    const s = byTicker.get("SMOL")!;
    const a = byTicker.get("AAPL")!;
    expect(n.score).toBeCloseTo(base * (0.08 / 0.05));
    expect(n.impliedMove).toBe(0.08);
    expect(s.score).toBeCloseTo(base * 0.5); // clamped low
    expect(a.score).toBeCloseTo(base * 3); // clamped high
  });
});
