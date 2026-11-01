import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalystDensity } from "../src/catalysts/density.js";
import { rankCatalysts } from "../src/catalysts/ranked.js";
import { ALWAYS_SHOWN_MACRO, DEFAULT_VIEW_MIN_SCORE, IMPORTANCE, classifyEvent, isAlwaysShown, macroSeries, scoreEvent, scoreParts, type EventClass } from "../src/scoring/importance.js";
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

  it("rankCatalysts default view returns ids in that same order (FR comment close gated out at 1.8 < 4.0)", () => {
    // GDP (5.4) ties the policy decision; kindRank puts macro first. PPI (3.6) rides in via ALWAYS_SHOWN_MACRO.
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
  it("GDP (0.9 conf) and PPI (1.0 conf, exactly 4.0) rows (exact, future, scheduled) both appear in the default view: cutoff is inclusive", () => {
    const rows = rankCatalysts(
      [
        cat({ id: "gdp", ticker: null, kind: "macro", dedupeKey: "bea:GDP:2026-03-20", title: "Gross domestic product", confidence: 0.9 }),
        cat({ id: "ppi", ticker: null, kind: "macro", dedupeKey: "bls:PPI:2026-03-20", title: "Producer price index", confidence: 1 }),
      ],
      { asOf: TODAY, watchlist: [] },
    );
    expect(rows.map((r) => r.id)).toEqual(["gdp", "ppi"]); // ppi exactly 4.0 stays (inclusive); 5.4 > 4.0
  });

  it("no marketCap tiers or importanceOverride remain in the scorer source", () => {
    const src = readFileSync("src/scoring/importance.ts", "utf8");
    expect(src).not.toContain("importanceOverride");
    expect(src).not.toContain("earnings_small");
  });

  it("reclassified weights: jobless claims 2, policy update due 1, megacap earnings 7", () => {
    expect(IMPORTANCE.jobless_claims).toBe(2);
    expect(IMPORTANCE.policy_update_due).toBe(1);
    expect(IMPORTANCE.earnings_mega).toBe(7);
    const jobless = cat({ id: "j", ticker: null, kind: "macro", dedupeKey: "dol:other:2026-03-20", title: "Initial jobless claims" });
    const updateDue = cat({ id: "u", ticker: null, kind: "rule_effective", dedupeKey: "policy:232", title: "Section 232 wind update due" });
    const mega = cat({ id: "m", title: "Nvidia earnings (Q1)", themes: ["megacap"] });
    expect(classifyEvent(jobless)).toBe("jobless_claims");
    expect(classifyEvent(updateDue)).toBe("policy_update_due");
    expect(classifyEvent(mega)).toBe("earnings_mega");
    expect(scoreEvent(jobless)).toBe(2);
    expect(scoreEvent(updateDue)).toBe(1);
    expect(scoreEvent(mega)).toBe(7);
  });

  it("non-US central bank decisions classify as central_bank_other (4); Fed stays fomc; bare rate decisions are macro_other", () => {
    for (const title of ["ECB rate decision", "Bank of Japan policy rate decision", "BoE interest rate decision"]) {
      const c = cat({ ticker: null, kind: "macro", dedupeKey: "x", title });
      expect(classifyEvent(c)).toBe("central_bank_other");
      expect(scoreEvent(c)).toBe(4);
    }
    for (const title of ["Fed interest rate decision", "FOMC rate decision"]) {
      expect(classifyEvent(cat({ ticker: null, kind: "macro", dedupeKey: "x", title }))).toBe("fomc");
    }
    expect(classifyEvent(cat({ ticker: null, kind: "macro", dedupeKey: "x", title: "Rate decision" }))).toBe("macro_other");
  });

  it("src/catalysts/ranked.ts no longer contains pin-list machinery", () => {
    const src = readFileSync("src/catalysts/ranked.ts", "utf8");
    expect(src).not.toContain("PINNED_MACRO");
    expect(src).not.toContain("isPinned");
  });

  it("not fomc: Fed-adjacent titles without a rate/policy decision are macro_other", () => {
    for (const title of ["Powell speech at Brookings", "Fed Beige Book", "Fed stress test results", "Atlanta Fed GDPNow update", "FedEx earnings", "FedEx freight rate decision", "FedEx earnings: fuel surcharge policy decision"]) {
      expect(macroSeries({ dedupeKey: "x", title })).not.toBe("fomc");
    }
  });

  it("is fomc: FOMC and fed/federal reserve rate or policy decisions", () => {
    for (const title of ["FOMC statement", "Fed interest rate decision", "Federal Reserve policy decision"]) {
      expect(macroSeries({ dedupeKey: "x", title })).toBe("fomc");
    }
  });

  it("central-bank abbreviations need rate/policy/monetary context; full names do not", () => {
    expect(macroSeries({ dedupeKey: "x", title: "BOC Aviation results" })).toBeNull();
    expect(macroSeries({ dedupeKey: "x", title: "Bank of Canada rate decision" })).toBe("central_bank_other");
    expect(macroSeries({ dedupeKey: "x", title: "BoC rate decision" })).toBe("central_bank_other");
    expect(macroSeries({ dedupeKey: "x", title: "ECB monetary policy meeting" })).toBe("central_bank_other");
  });

  it("ALWAYS_SHOWN_MACRO covers the high-importance series but not jobless_claims", () => {
    expect([...ALWAYS_SHOWN_MACRO].sort()).toEqual(
      ["central_bank_other", "cpi", "fomc", "gdp", "jolts", "nfp", "pce", "ppi", "retail_sales"].sort(),
    );
    expect(ALWAYS_SHOWN_MACRO.has("jobless_claims")).toBe(false);
  });

  it("isAlwaysShown is macro-only and follows the series classification", () => {
    expect(isAlwaysShown(cat({ ticker: null, kind: "macro", dedupeKey: "bls:CPI:2026-03-20", title: "Consumer Price Index" }))).toBe(true);
    expect(isAlwaysShown(cat({ ticker: null, kind: "macro", dedupeKey: "x", title: "Initial jobless claims" }))).toBe(false);
    expect(isAlwaysShown(cat({ ticker: null, kind: "election", title: "US midterm elections" }))).toBe(false);
  });

  it("PPI rows ride in the default view even with a low score; jobless claims (2) do not", () => {
    const rows = rankCatalysts(
      [
        cat({ id: "ppi-est", ticker: null, kind: "macro", dedupeKey: "bls:PPI:2026-03-20", title: "Producer price index", datePrecision: "estimated", dateStart: "2026-03-20", dateEnd: "2026-03-20", confidence: 1 }),
        cat({ id: "ppi-exact", ticker: null, kind: "macro", dedupeKey: "bls:PPI:2026-03-25", title: "Producer price index", confidence: 0.9 }),
        cat({ id: "jc", ticker: null, kind: "macro", dedupeKey: "dol:other:2026-03-20", title: "Initial jobless claims", confidence: 1 }),
      ],
      { asOf: TODAY, watchlist: [] },
    );
    // estimated PPI scores 4 x 0.4 = 1.6, exact/0.9 scores 3.6: both below the 4.0 cutoff yet shown; jobless claims 2 is not.
    expect(rows.map((r) => r.id)).toEqual(["ppi-exact", "ppi-est"]);
    expect(rows.every((r) => r.score < DEFAULT_VIEW_MIN_SCORE)).toBe(true);
  });
});

describe("impactWeight removal", () => {
  it("no file under src/ or data/ mentions impactWeight", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk("src");
    walk("data");
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes("impactWeight"));
    expect(offenders).toEqual([]);
  });
});
