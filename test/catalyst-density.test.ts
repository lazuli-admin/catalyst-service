import { describe, expect, it } from "vitest";
import { catalystDensity, KIND_WEIGHTS, LEAD_MULTIPLIERS, CLUSTER_BONUS_PER_KIND } from "../src/catalysts/density.js";
import { IMPORTANCE, scoreEvent } from "../src/scoring/importance.js";
import type { Catalyst } from "../src/types.js";

const TODAY = "2026-03-01";

const ACT = LEAD_MULTIPLIERS.actionable;
const PRICED = LEAD_MULTIPLIERS.priced;

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
    expect(rows[0]!.score).toBeCloseTo(IMPORTANCE.corporate_major * 1 * 1 * ACT);
  });

  it("applies certainty multipliers and lead-time buckets", () => {
    // Exact date = full certainty
    const exact = catalystDensity([cat()], { asOf: TODAY })[0]!;
    expect(exact.score).toBeCloseTo(scoreEvent(cat()) * ACT);

    // Window date with narrow window = full certainty
    const narrow = cat({ datePrecision: "window", dateEnd: "2026-03-15" });
    const narrowWindow = catalystDensity([narrow], { asOf: TODAY })[0]!;
    expect(narrowWindow.score).toBeCloseTo(scoreEvent(narrow) * ACT);

    // Wide window = reduced certainty
    const wide = cat({ datePrecision: "window", dateEnd: "2026-04-10" });
    const wideWindow = catalystDensity([wide], { asOf: TODAY })[0]!;
    expect(wideWindow.score).toBeCloseTo(scoreEvent(wide) * ACT);

    // Estimated date = lowest certainty
    const est = cat({ datePrecision: "estimated" });
    const estimated = catalystDensity([est], { asOf: TODAY })[0]!;
    expect(estimated.score).toBeCloseTo(scoreEvent(est) * ACT);

    // Lead-time buckets
    const pricedFix = cat({ dateStart: "2026-03-05" });
    const priced = catalystDensity([pricedFix], { asOf: TODAY })[0]!;
    expect(priced.score).toBeCloseTo(scoreEvent(pricedFix) * PRICED);

    const actionableFix = cat({ dateStart: "2026-03-20" });
    const actionable = catalystDensity([actionableFix], { asOf: TODAY })[0]!;
    expect(actionable.score).toBeCloseTo(scoreEvent(actionableFix) * ACT);

    const watchFix = cat({ dateStart: "2026-04-15" });
    const watchlist = catalystDensity([watchFix], { asOf: TODAY })[0]!;
    expect(watchlist.score).toBeCloseTo(scoreEvent(watchFix) * LEAD_MULTIPLIERS.watchlist);

    const distFix = cat({ dateStart: "2026-11-16" });
    const distant = catalystDensity([distFix], { asOf: TODAY })[0]!;
    expect(distant.score).toBeCloseTo(scoreEvent(distFix) * LEAD_MULTIPLIERS.distant);
  });

  it("uses 10 trading days as the window-certainty threshold", () => {
    // 2026-03-10 .. 2026-03-24 spans exactly 10 weekdays -> still 0.7.
    const edgeFix = cat({ datePrecision: "window", dateEnd: "2026-03-24" });
    const edge = catalystDensity([edgeFix], { asOf: TODAY })[0]!;
    expect(edge.score).toBeCloseTo(scoreEvent(edgeFix) * ACT);
    // One more weekday (11) falls past the threshold -> 0.4.
    const pastFix = cat({ datePrecision: "window", dateEnd: "2026-03-25" });
    const past = catalystDensity([pastFix], { asOf: TODAY })[0]!;
    expect(past.score).toBeCloseTo(scoreEvent(pastFix) * ACT);
  });

  it("counts affectedTickers at half weight", () => {
    const rows = catalystDensity([cat({ affectedTickers: ["AMD"] })], { asOf: TODAY });
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    const amd = rows.find((r) => r.ticker === "AMD")!;
    expect(nvda.score).toBeCloseTo(scoreEvent(cat()) * 1 * 1 * ACT);
    expect(amd.score).toBeCloseTo(scoreEvent(cat()) * 1 * 1 * ACT * 0.5);
  });

  it("gives cluster bonus for distinct kinds in same time window", () => {
    const a = cat({ kind: "earnings", title: "E" });
    const b = cat({ kind: "deal_close", title: "D" });
    const c = cat({ kind: "product_launch", title: "P", ticker: "AMD" });
    const rows = catalystDensity([c, a, b], { asOf: TODAY });

    // Should have cluster bonus for NVDA (earnings + deal_close); bonus is scaled by the max lead
    // multiplier (both items are in the actionable bucket = 1.0).
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    expect(nvda.score).toBeCloseTo(
      IMPORTANCE.earnings_large * ACT + IMPORTANCE.corporate_major * ACT + CLUSTER_BONUS_PER_KIND * ACT,
    );
    expect(rows.map((r) => r.ticker)).toEqual(["NVDA", "AMD"]);
    expect(rows[0]!.score).toBeGreaterThan(rows[1]!.score);
  });

  it("scales cluster bonus by the max lead multiplier in the cluster", () => {
    const a = cat({ kind: "earnings", title: "E", dateStart: "2026-03-05" }); // priced bucket (0.5)
    const b = cat({ kind: "deal_close", title: "D", dateStart: "2026-03-05" });
    const rows = catalystDensity([a, b], { asOf: TODAY });
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    expect(nvda.score).toBeCloseTo(
      IMPORTANCE.earnings_large * PRICED + IMPORTANCE.corporate_major * PRICED + CLUSTER_BONUS_PER_KIND * PRICED,
    );
    expect(nvda.actionableScore).toBe(0); // priced items are not actionable
  });

  it("adds cluster bonus to actionableScore when any cluster item is actionable", () => {
    const a = cat({ kind: "earnings", title: "E" });
    const b = cat({ kind: "deal_close", title: "D", dateStart: "2026-03-20" }); // actionable bucket
    const rows = catalystDensity([a, b], { asOf: TODAY });
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    const base = IMPORTANCE.earnings_large * ACT + IMPORTANCE.corporate_major * ACT;
    expect(nvda.score).toBeCloseTo(base + CLUSTER_BONUS_PER_KIND * ACT);
    expect(nvda.actionableScore).toBeCloseTo(base + CLUSTER_BONUS_PER_KIND * ACT);
  });

  it("does not chain clusters beyond 10 trading days from the first item", () => {
    const a = cat({ kind: "earnings", title: "E", dateStart: "2026-03-10" });
    const b = cat({ kind: "deal_close", title: "D", dateStart: "2026-03-20" }); // within 10 of a
    const c = cat({ kind: "product_launch", title: "P", dateStart: "2026-03-30" }); // 14 trading days from a, but 7 from b
    const rows = catalystDensity([a, b, c], { asOf: TODAY });
    const nvda = rows.find((r) => r.ticker === "NVDA")!;
    // Old chaining would bonus all three; now c starts its own cluster (no bonus for a lone item).
    expect(nvda.score).toBeCloseTo(
      IMPORTANCE.earnings_large * ACT +
        IMPORTANCE.corporate_major * ACT +
        CLUSTER_BONUS_PER_KIND * ACT +
        IMPORTANCE.other * ACT,
    );
    expect(nvda.clusters).toHaveLength(1);
    expect(nvda.clusters[0]!.start).toBe("2026-03-10");
    expect(nvda.clusters[0]!.kinds).toEqual(["earnings", "deal_close"]);
  });

  it("never clusters policy events with non-policy events", () => {
    const earnings = cat({ kind: "earnings", title: "E", dateStart: "2026-03-10" });
    const policy = cat({ kind: "rule_effective", title: "Rule effective", dedupeKey: "policy:rule-1", dateStart: "2026-03-12" });
    const nvda = catalystDensity([earnings, policy], { asOf: TODAY }).find((r) => r.ticker === "NVDA")!;
    expect(nvda.score).toBeCloseTo(IMPORTANCE.earnings_large * ACT + IMPORTANCE.policy_decision * ACT); // no cluster bonus across the policy/non-policy boundary
    expect(nvda.clusters).toHaveLength(0);
  });

  it("clusters policy events with each other and keeps entry.clusters sorted by start", () => {
    const earnings = cat({ kind: "earnings", title: "E", dateStart: "2026-03-10" });
    const deal = cat({ kind: "deal_close", title: "D", dateStart: "2026-03-11" });
    const policyRule = cat({ kind: "rule_effective", title: "Rule effective", dedupeKey: "policy:rule-1", dateStart: "2026-03-12" });
    const frDecision = cat({ kind: "regulatory_decision", title: "FR decision", dedupeKey: "fr:decision-1", dateStart: "2026-03-12" });
    const nvda = catalystDensity([earnings, deal, policyRule, frDecision], { asOf: TODAY }).find((r) => r.ticker === "NVDA")!;
    expect(nvda.clusters).toHaveLength(2);
    expect(nvda.clusters[0]!.kinds).toEqual(["earnings", "deal_close"]); // starts 2026-03-10
    expect(nvda.clusters[1]!.kinds).toEqual(["rule_effective", "regulatory_decision"]); // starts 2026-03-12
    expect(nvda.score).toBeCloseTo(
      IMPORTANCE.earnings_large * ACT +
        IMPORTANCE.corporate_major * ACT +
        CLUSTER_BONUS_PER_KIND * ACT +
        IMPORTANCE.policy_decision * ACT * 2 +
        CLUSTER_BONUS_PER_KIND * ACT,
    ); // one bonus per group
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
