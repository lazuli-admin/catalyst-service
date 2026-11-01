import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalystDensity } from "../src/catalysts/density.js";
import { rankCatalysts } from "../src/catalysts/ranked.js";
import { classifyEvent, macroSeries, scoreEvent, scoreParts, type EventClass } from "../src/scoring/importance.js";
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

describe("macroSeries", () => {
  it("maps dedupeKey prefixes to series and falls back to title regexes", () => {
    const byKey: Array<[string, EventClass]> = [
      ["bls:CPI:2026-03-20", "cpi"],
      ["bls:Jobs report:2026-03-20", "nfp"],
      ["bls:PPI:2026-03-20", "ppi"],
      ["bls:JOLTS:2026-03-20", "jolts"],
      ["bea:PCE:2026-03-20", "pce"],
      ["bea:GDP:2026-03-20", "gdp"],
      ["fed:fomc:2026-03-20", "fomc"],
    ];
    for (const [key, series] of byKey) {
      expect(macroSeries({ dedupeKey: key, title: "anything at all" })).toBe(series);
    }
    const byTitle: Array<[string, EventClass]> = [
      ["Retail Sales", "retail_sales"],
      ["Initial jobless claims", "jobless_claims"],
      ["Consumer Price Index", "cpi"],
    ];
    for (const [title, series] of byTitle) {
      expect(macroSeries({ dedupeKey: "other-source:2026-03-20", title })).toBe(series);
    }
  });

  it("renaming the title of a bls:CPI: row does not change scoreEvent", () => {
    const base = cat({ ticker: null, kind: "macro", dedupeKey: "bls:CPI:2026-03-20", title: "Consumer Price Index (CPI) for March 2026" });
    expect(scoreEvent(base)).toBeCloseTo(8);
    expect(scoreEvent({ ...base, title: "Totally unrelated headline" })).toBeCloseTo(8);
  });

  it("classifies every BLS schedule series away from macro_other", () => {
    const schedule = JSON.parse(readFileSync("data/bls-schedule.json", "utf8")) as { releases: Array<{ series: string }> };
    const series = [...new Set(schedule.releases.map((r) => r.series))];
    expect(series.length).toBeGreaterThan(0);
    for (const s of series) {
      const c = cat({ ticker: null, kind: "macro", dedupeKey: `bls:${s}:2026-12-01`, title: s });
      expect(classifyEvent(c)).not.toBe("macro_other");
    }
  });
});

describe("score monotonicity", () => {
  it("scoreParts is non-decreasing in each argument over the grid", () => {
    for (const importance of [0, 1, 2, 4, 6, 8, 10]) {
      for (const certainty of [0, 0.4, 0.7, 1]) {
        for (const confidence of [0, 0.25, 0.5, 0.9, 1]) {
          expect(scoreParts(importance, certainty, confidence)).toBeGreaterThanOrEqual(0);
          expect(scoreParts(importance, certainty, confidence)).toBeLessThanOrEqual(
            scoreParts(importance, certainty, confidence + 0.1) + 1e-9,
          );
          expect(scoreParts(importance, certainty, confidence)).toBeLessThanOrEqual(
            scoreParts(importance, certainty + 0.1, confidence) + 1e-9,
          );
          expect(scoreParts(importance, certainty, confidence)).toBeLessThanOrEqual(
            scoreParts(importance + 0.1, certainty, confidence) + 1e-9,
          );
        }
      }
    }
  });

  it("on catalysts, raising confidence never lowers scoreEvent, and precision estimated <= narrow window <= exact", () => {
    const variants = [
      cat({ ticker: null, kind: "macro", dedupeKey: "bls:CPI:2026-03-20", title: "CPI" }),
      cat({ ticker: null, kind: "rule_effective", dedupeKey: "policy:x", title: "Final rule effective" }),
      cat({ title: "Smolco earnings (Q1)" }),
    ];
    for (const c of variants) {
      let prev = -1;
      for (const confidence of [0, 0.25, 0.5, 0.9, 1]) {
        const s = scoreEvent({ ...c, confidence });
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
      }
      const estimated = scoreEvent({ ...c, datePrecision: "estimated", confidence: 1 });
      const narrow = scoreEvent({ ...c, datePrecision: "window", dateStart: "2026-03-20", dateEnd: "2026-03-24", confidence: 1 });
      const exact = scoreEvent({ ...c, datePrecision: "exact", confidence: 1 });
      expect(estimated).toBeLessThanOrEqual(narrow);
      expect(narrow).toBeLessThanOrEqual(exact);
    }
  });
});

describe("order sanity", () => {
  const rows = [
    cat({ id: "fomc", ticker: null, kind: "macro", dedupeKey: "fed:fomc:2026-03-20", title: "FOMC rate decision" }),
    cat({ id: "cpi", ticker: null, kind: "macro", dedupeKey: "bls:CPI:2026-03-20", title: "Consumer Price Index" }),
    cat({ id: "gdp", ticker: null, kind: "macro", dedupeKey: "bea:GDP:2026-03-20", title: "Gross domestic product" }),
    cat({ id: "ppi", ticker: null, kind: "macro", dedupeKey: "bls:PPI:2026-03-20", title: "Producer price index" }),
    cat({ id: "fr-c", ticker: null, kind: "regulatory_decision", dedupeKey: "fr:2026-1:comments:2026-03-20", title: "Comments close on the draft rule" }),
    cat({ id: "fr-d", ticker: null, kind: "rule_effective", dedupeKey: "fr:2026-1:2026-03-20", title: "Final rule effective" }),
  ].map((c) => ({ ...c, confidence: 0.9 }));

  it("scoreEvent orders FOMC > CPI > GDP > PPI > FR comment close, and the policy decision beats its comment close", () => {
    const scores = new Map(rows.map((c) => [c.id, scoreEvent(c)]));
    expect(scores.get("fomc")!).toBeCloseTo(9); // 10 * 0.9
    expect(scores.get("cpi")!).toBeCloseTo(7.2); // 8 * 0.9
    expect(scores.get("gdp")!).toBeCloseTo(5.4); // 6 * 0.9
    expect(scores.get("ppi")!).toBeCloseTo(3.6); // 4 * 0.9
    expect(scores.get("fr-c")!).toBeCloseTo(1.8); // policy_comment_close 2 * 0.9
    expect(scores.get("fr-d")!).toBeCloseTo(5.4); // policy_decision 6 * 0.9
    expect(scores.get("fomc")!).toBeGreaterThan(scores.get("cpi")!);
    expect(scores.get("cpi")!).toBeGreaterThan(scores.get("gdp")!);
    expect(scores.get("gdp")!).toBeGreaterThan(scores.get("ppi")!);
    expect(scores.get("ppi")!).toBeGreaterThan(scores.get("fr-c")!);
    expect(scores.get("fr-d")!).toBeGreaterThan(scores.get("fr-c")!);
  });

  it("rankCatalysts default view returns ids in that same order (FR comment close gated out at 1.8 < 2.0)", () => {
    // GDP (5.4) ties the policy decision; kindRank puts macro first.
    expect(rankCatalysts(rows, { asOf: TODAY, watchlist: [] }).map((r) => r.id)).toEqual(["fomc", "cpi", "gdp", "fr-d", "ppi"]);
    expect(rankCatalysts(rows, { asOf: TODAY, watchlist: [], all: true }).map((r) => r.id)).toEqual(["fomc", "cpi", "gdp", "fr-d", "ppi", "fr-c"]);
  });
});

describe("ranking == clustering", () => {
  it("rankCatalysts score equals catalystDensity baseScore equals scoreEvent for off-watchlist catalysts", () => {
    const cats = [
      cat({ id: "e", ticker: "XYZ", title: "XYZ earnings (Q1)", dateStart: "2026-03-20" }),
      cat({ id: "p", ticker: "ABC", kind: "rule_effective", dedupeKey: "policy:x", title: "Final rule effective", dateStart: "2026-03-21" }),
      cat({ id: "m", ticker: "MCR", kind: "macro", dedupeKey: "bls:CPI:2026-03-20", title: "Consumer Price Index", dateStart: "2026-03-22" }),
    ];
    const ranked = rankCatalysts(cats, { asOf: TODAY, all: true, watchlist: [] });
    const density = catalystDensity(cats, { asOf: TODAY });
    for (const c of cats) {
      const r = ranked.find((x) => x.id === c.id)!;
      const items = density.flatMap((t) => t.items).filter((i) => i.catalyst.id === c.id);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.baseScore).toBeCloseTo(scoreEvent(c));
      }
      expect(r.score).toBeCloseTo(scoreEvent(c));
    }
  });
});

describe("default view gating", () => {
  it("GDP and PPI rows (exact, confidence 0.9, future, scheduled) both appear in the default view", () => {
    const rows = rankCatalysts(
      [
        cat({ id: "gdp", ticker: null, kind: "macro", dedupeKey: "bea:GDP:2026-03-20", title: "Gross domestic product", confidence: 0.9 }),
        cat({ id: "ppi", ticker: null, kind: "macro", dedupeKey: "bls:PPI:2026-03-20", title: "Producer price index", confidence: 0.9 }),
      ],
      { asOf: TODAY, watchlist: [] },
    );
    expect(rows.map((r) => r.id)).toEqual(["gdp", "ppi"]);
  });

  it("src/catalysts/ranked.ts no longer contains pin-list machinery", () => {
    const src = readFileSync("src/catalysts/ranked.ts", "utf8");
    expect(src).not.toContain("PINNED_MACRO");
    expect(src).not.toContain("isPinned");
  });
});
