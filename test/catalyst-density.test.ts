import { describe, expect, it } from "vitest";
import { catalystDensity, KIND_WEIGHTS } from "../src/catalysts/density.js";
import type { Catalyst } from "../src/types.js";

const TODAY = "2026-03-01";

function cat(overrides: Partial<Catalyst> = {}): Catalyst {
  return {
    id: "c",
    ticker: "NVDA",
    title: "Earnings call",
    kind: "earnings",
    status: "expected",
    dateStart: "2026-03-10",
    dateEnd: "2026-03-10",
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

describe("catalystDensity", () => {
  it("weights kinds and skips tickerless catalysts", () => {
    expect(KIND_WEIGHTS.regulatory_decision).toBe(1.0);
    const rows = catalystDensity([cat({ ticker: null }), cat({ kind: "regulatory_decision", title: "FDA decision" })], { today: TODAY, horizonDays: 90 });
    expect(rows).toEqual([{ ticker: "NVDA", score: 1, count: 1, kinds: ["regulatory_decision"], catalysts: [rows[0]!.catalysts[0]!] }]);
  });

  it("applies proximity: near = full weight, far = 0.3 floor", () => {
    const near = catalystDensity([cat()], { today: TODAY, horizonDays: 90 })[0]!;
    expect(near.score).toBeCloseTo(0.8);
    const far = catalystDensity([cat({ dateStart: "2026-05-30" })], { today: TODAY, horizonDays: 90 })[0]!;
    expect(far.score).toBeCloseTo(0.8 * 0.3);
    // 60 days: linear between 1 at 30 and 0.3 at 90 -> 1 - 0.7*0.5 = 0.65
    const mid = catalystDensity([cat({ dateStart: "2026-04-30" })], { today: TODAY, horizonDays: 90 })[0]!;
    expect(mid.score).toBeCloseTo(0.8 * 0.65);
  });

  it("counts affectedTickers at half weight and confirmed status at 1.2x", () => {
    const rows = catalystDensity([cat({ affectedTickers: ["AMD"], status: "confirmed", confidence: 0.5 })], { today: TODAY, horizonDays: 90 });
    const w = 0.8 * 0.5 * 1 * 1.2;
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    const amd = rows.find((r) => r.ticker === "AMD")!;
    expect(nvda.score).toBeCloseTo(w);
    expect(amd.score).toBeCloseTo(w * 0.5);
  });

  it("boosts clusters of distinct kinds and orders descending", () => {
    const a = cat({ kind: "earnings", title: "E" });
    const b = cat({ kind: "deal_close", title: "D" });
    const c = cat({ kind: "product_launch", title: "P", ticker: "AMD" });
    const rows = catalystDensity([c, a, b], { today: TODAY, horizonDays: 90 });
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    expect(nvda!.kinds).toHaveLength(2);
    expect(nvda.score).toBeCloseTo((0.8 + 0.9) * 1.25);
    expect(rows.map((r) => r.ticker)).toEqual(["NVDA", "AMD"]);
    expect(rows[0]!.score).toBeGreaterThan(rows[1]!.score);
  });
});
