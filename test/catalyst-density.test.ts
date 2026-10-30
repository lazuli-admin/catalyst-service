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
    status: "scheduled",
    dateStart: "2026-03-10",
    dateEnd: "2026-03-10",
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

describe("catalystDensity", () => {
  it("weights kinds and skips tickerless catalysts", () => {
    expect(KIND_WEIGHTS.regulatory_decision).toBe(3);
    const rows = catalystDensity([cat({ ticker: null }), cat({ kind: "regulatory_decision", title: "FDA decision" })], { asOf: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticker).toBe("NVDA");
    expect(rows[0]!.score).toBeCloseTo(3 * 1 * 1 * 1);
  });

  it("applies certainty multipliers and lead-time buckets", () => {
    // Exact date = full certainty
    const exact = catalystDensity([cat()], { asOf: TODAY })[0]!;
    expect(exact.score).toBeCloseTo(3 * 1 * 1);

    // Window date with narrow window = full certainty
    const narrowWindow = catalystDensity([cat({ datePrecision: "window", dateEnd: "2026-03-15" })], { asOf: TODAY })[0]!;
    expect(narrowWindow.score).toBeCloseTo(3 * 0.7);

    // Wide window = reduced certainty
    const wideWindow = catalystDensity([cat({ datePrecision: "window", dateEnd: "2026-04-10" })], { asOf: TODAY })[0]!;
    expect(wideWindow.score).toBeCloseTo(3 * 0.4);

    // Estimated date = lowest certainty
    const estimated = catalystDensity([cat({ datePrecision: "estimated" })], { asOf: TODAY })[0]!;
    expect(estimated.score).toBeCloseTo(3 * 0.4);

    // Lead-time buckets
    const priced = catalystDensity([cat({ dateStart: "2026-03-05" })], { asOf: TODAY })[0]!;
    expect(priced.score).toBeCloseTo(3 * 0.5);

    const actionable = catalystDensity([cat({ dateStart: "2026-03-20" })], { asOf: TODAY })[0]!;
    expect(actionable.score).toBeCloseTo(3 * 1);

    const watchlist = catalystDensity([cat({ dateStart: "2026-04-15" })], { asOf: TODAY })[0]!;
    expect(watchlist.score).toBeCloseTo(3 * 0.6);

    const distant = catalystDensity([cat({ dateStart: "2026-11-16" })], { asOf: TODAY })[0]!;
    expect(distant.score).toBeCloseTo(3 * 0.3);
  });

  it("uses 10 trading days as the window-certainty threshold", () => {
    // 2026-03-10 .. 2026-03-24 spans exactly 10 weekdays -> still 0.7.
    const edge = catalystDensity([cat({ datePrecision: "window", dateEnd: "2026-03-24" })], { asOf: TODAY })[0]!;
    expect(edge.score).toBeCloseTo(3 * 0.7);
    // One more weekday (11) falls past the threshold -> 0.4.
    const past = catalystDensity([cat({ datePrecision: "window", dateEnd: "2026-03-25" })], { asOf: TODAY })[0]!;
    expect(past.score).toBeCloseTo(3 * 0.4);
  });

  it("counts affectedTickers at half weight", () => {
    const rows = catalystDensity([cat({ affectedTickers: ["AMD"] })], { asOf: TODAY });
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    const amd = rows.find((r) => r.ticker === "AMD")!;
    expect(nvda.score).toBeCloseTo(3 * 1 * 1 * 1);
    expect(amd.score).toBeCloseTo(3 * 1 * 1 * 1 * 0.5);
  });

  it("gives cluster bonus for distinct kinds in same time window", () => {
    const a = cat({ kind: "earnings", title: "E" });
    const b = cat({ kind: "deal_close", title: "D" });
    const c = cat({ kind: "product_launch", title: "P", ticker: "AMD" });
    const rows = catalystDensity([c, a, b], { asOf: TODAY });

    // Should have cluster bonus for NVDA (earnings + deal_close); bonus is scaled by the max lead
    // multiplier (both items are in the actionable bucket = 1.0).
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    expect(nvda.score).toBeCloseTo(3 * 1 * 1 * 1 + 3 * 1 * 1 * 1 + 1.5 * 1); // +1.5 for distinct kinds cluster
    expect(rows.map((r) => r.ticker)).toEqual(["NVDA", "AMD"]);
    expect(rows[0]!.score).toBeGreaterThan(rows[1]!.score);
  });

  it("scales cluster bonus by the max lead multiplier in the cluster", () => {
    const a = cat({ kind: "earnings", title: "E", dateStart: "2026-03-05" }); // priced bucket (0.5)
    const b = cat({ kind: "deal_close", title: "D", dateStart: "2026-03-05" });
    const rows = catalystDensity([a, b], { asOf: TODAY });
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    expect(nvda.score).toBeCloseTo(3 * 0.5 * 2 + 1.5 * 0.5);
    expect(nvda.actionableScore).toBe(0); // priced items are not actionable
  });

  it("adds cluster bonus to actionableScore when any cluster item is actionable", () => {
    const a = cat({ kind: "earnings", title: "E" });
    const b = cat({ kind: "deal_close", title: "D", dateStart: "2026-03-20" }); // actionable bucket
    const rows = catalystDensity([a, b], { asOf: TODAY });
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    const base = 3 * 1 * 1 + 3 * 1 * 1;
    expect(nvda.score).toBeCloseTo(base + 1.5);
    expect(nvda.actionableScore).toBeCloseTo(base + 1.5);
  });

  it("does not chain clusters beyond 10 trading days from the first item", () => {
    const a = cat({ kind: "earnings", title: "E", dateStart: "2026-03-10" });
    const b = cat({ kind: "deal_close", title: "D", dateStart: "2026-03-20" }); // within 10 of a
    const c = cat({ kind: "product_launch", title: "P", dateStart: "2026-03-30" }); // 14 trading days from a, but 7 from b
    const rows = catalystDensity([a, b, c], { asOf: TODAY });
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    // Old chaining would bonus all three; now c starts its own cluster (no bonus for a lone item).
    expect(nvda.score).toBeCloseTo(3 + 3 + 1.5 + 1);
    expect(nvda.clusters).toHaveLength(1);
    expect(nvda.clusters[0]!.start).toBe("2026-03-10");
    expect(nvda.clusters[0]!.kinds).toEqual(["earnings", "deal_close"]);
  });

  it("excludes leads, cancelled, done, and past catalysts", () => {
    const rows = catalystDensity([
      cat({ status: "lead" }),
      cat({ status: "cancelled" }),
      cat({ status: "done" }),
      cat({ dateStart: "2026-02-20", dateEnd: "2026-02-25" }),
      cat({ dateStart: "2026-03-01", dateEnd: "2026-03-05" }), // dateEnd == asOf is still future
      cat(),
    ], { asOf: TODAY });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticker).toBe("NVDA");
  });
});
