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
      { asOf: TODAY, watchlist: [], all: true },
    );
    // earnings_large 4, corporate_major 5, window certainty 0.7 x confidence 0.5
    expect(rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(rows[1]!.score).toBeCloseTo(4 * 1 * 1);
    expect(rows[2]!.score).toBeCloseTo(4 * 0.7 * 0.5);
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

  it("macro rides in the default view by score: CPI (8) and federal elections (6) clear the bar, unknown macro (1) stays out", () => {
    const rows = rankCatalysts(
      [
        cat({ ticker: null, kind: "macro", title: "US CPI release" }),
        cat({ ticker: null, kind: "macro", title: "US Retail Sales" }),
        cat({ ticker: null, kind: "election", title: "US midterm elections" }),
      ],
      { asOf: TODAY, watchlist: [] },
    );
    // CPI 8, Retail Sales 4, election_federal 6 — all >= DEFAULT_VIEW_MIN_SCORE (2.0).
    expect(rows.map((r) => r.title).sort()).toEqual(["US CPI release", "US Retail Sales", "US midterm elections"]);
    expect(rankCatalysts([cat({ ticker: null, kind: "macro", title: "Michigan consumer sentiment" })], { asOf: TODAY, watchlist: [] })).toHaveLength(0); // macro_other 1 < 2
    expect(rows.every((r) => !("pinned" in r))).toBe(true);
  });

  it("macro rows score by event class (no pin boost, no impactWeight override); off-watchlist earnings at class weight", () => {
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
    expect(by.get("US CPI: October inflation print")).toBeCloseTo(8);
    expect(by.get("US Jobs report: payrolls")).toBeCloseTo(8); // nfp
    expect(by.get("US PPI: producer prices")).toBeCloseTo(4);
    expect(by.get("Off-watchlist earnings")).toBeCloseTo(4); // earnings_large
  });

  it("federal elections score 6 and rank between CPI-class macro (8) and retail sales (4)", () => {
    const rows = rankCatalysts(
      [
        cat({ ticker: null, kind: "election", title: "US midterm elections", dateStart: "2026-03-25" }),
        cat({ ticker: null, kind: "macro", title: "US CPI: October inflation print", dateStart: "2026-03-25" }),
        cat({ ticker: null, kind: "macro", title: "US Retail Sales", dateStart: "2026-03-25" }),
      ],
      { asOf: TODAY, watchlist: [], all: true },
    );
    const by = new Map(rows.map((r) => [r.title, r.score]));
    expect(by.get("US midterm elections")).toBeCloseTo(6); // election_federal
    expect(by.get("US CPI: October inflation print")).toBeCloseTo(8);
    expect(by.get("US Retail Sales")).toBeCloseTo(4);
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

  it("focus earnings and macro rank above off-watchlist earnings regardless of days out (no lead multiplier)", () => {
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
    // cpi 8, focus-far 4x2=8, jolts 4, off-now 4, off-far 4; kind tie-break: macro before earnings, then date asc.
    expect(rows.map((r) => r.id)).toEqual(["cpi-far", "focus-far", "jolts-far", "off-now", "off-far"]);
    expect(rows[0]!.score).toBeCloseTo(8);
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

describe("policy scoring", () => {
  it("policy:* regulatory_decision rows score 6 (policy_decision) regardless of impactWeight; FR comment-close rows score 2 and rank below", () => {
    const rows = rankCatalysts(
      [
        cat({ id: "p", ticker: null, kind: "regulatory_decision", dedupeKey: "policy:foo", impactWeight: 3 }),
        cat({ id: "m", ticker: null, kind: "regulatory_decision", dedupeKey: "policy:bar", impactWeight: 2 }),
        cat({ id: "fr", ticker: null, kind: "regulatory_decision", dedupeKey: "fr:2026-1:comments:2026-03-20", title: "Comments close on the draft rule" }),
      ],
      { asOf: TODAY, watchlist: [], all: true },
    );
    expect(rows.map((r) => r.id)).toEqual(["m", "p", "fr"]); // 6/6 tie: alphabetical id
    expect(rows[0]!.score).toBeCloseTo(6);
    expect(rows[1]!.score).toBeCloseTo(6);
    expect(rows[2]!.score).toBeCloseTo(2); // policy_comment_close
  });

  it("impactWeight is ignored: earnings score their class (4) and CPI macro (8) ranks first", () => {
    const earnings = cat({ id: "e", kind: "earnings", impactWeight: 3, title: "Smolco earnings (Q1)", dateStart: "2026-03-20", dateEnd: "2026-03-20" });
    const macro = cat({ id: "x", ticker: null, kind: "macro", dedupeKey: "bls:CPI:2026-03-20", impactWeight: 3, title: "US CPI release", dateStart: "2026-03-20", dateEnd: "2026-03-20" });
    const rows = rankCatalysts([earnings, macro], { asOf: TODAY, watchlist: [] });
    expect(rows.map((r) => r.id)).toEqual(["x", "e"]);
    expect(rows[0]!.score).toBeCloseTo(8); // cpi
    expect(rows[1]!.score).toBeCloseTo(4); // earnings_large (no megacap theme)
  });

  it("wide-window policy rows are down-weighted: policy_other (1.2) drops out of the default view, rule_effective (2.4) stays", () => {
    const litigation = cat({ id: "w", ticker: null, kind: "litigation", status: "scheduled", dateStart: "2026-03-05", dateEnd: "2026-04-30", datePrecision: "window", dedupeKey: "policy:trial" });
    const effective = cat({ id: "eff", ticker: null, kind: "rule_effective", status: "scheduled", dateStart: "2026-03-05", dateEnd: "2026-04-30", datePrecision: "window", dedupeKey: "policy:eff" });
    expect(rankCatalysts([litigation, effective], { asOf: TODAY, watchlist: [] }).map((r) => r.id)).toEqual(["eff"]); // 6*0.4=2.4 >= 2.0
    const all = rankCatalysts([litigation, effective], { asOf: TODAY, watchlist: [], all: true });
    expect(all.map((r) => r.id)).toEqual(["eff", "w"]);
    expect(all[1]!.score).toBeCloseTo(1.2); // policy_other 3 * wideWindow 0.4
  });
});
