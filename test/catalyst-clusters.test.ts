import { describe, expect, it } from "vitest";
import { catalystDensity } from "../src/catalysts/density.js";
import { mergeSharedClusters, renderCalendarPage } from "../src/catalysts/page.js";
import type { Catalyst } from "../src/types.js";

const cat = (overrides: Partial<Catalyst> = {}): Catalyst => ({
  id: "c",
  ticker: null,
  title: "Catalyst",
  kind: "earnings",
  status: "scheduled",
  dateStart: "2026-11-04",
  dateEnd: "2026-11-04",
  datePrecision: "exact",
  confidence: 1,
  sourceTier: 1,
  themes: [],
  affectedTickers: [],
  sourceUrl: null,
  impactWeight: null,
  observationId: null,
  dedupeKey: "k",
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
  ...overrides,
});

const BIS = {
  id: "bis",
  title: "BIS affiliates rule back in force Nov 11 (suspension ends Nov 10) — Suspension of Export Controls",
  kind: "rule_effective" as const,
  dateStart: "2026-11-03",
  dateEnd: "2026-11-03",
  datePrecision: "window" as const,
  affectedTickers: ["NVDA", "AMD", "AMAT"],
};

describe("mergeSharedClusters", () => {
  it("merges clusters from different tickers that share a tickerless catalyst into ONE cluster", () => {
    const cats = [
      cat(BIS),
      cat({ id: "amd-e", ticker: "AMD", title: "AMD Q3 earnings", dateStart: "2026-11-04" }),
      cat({ id: "nvda-e", ticker: "NVDA", title: "NVDA Q3 earnings", dateStart: "2026-11-12" }),
      cat({ id: "amat-e", ticker: "AMAT", title: "AMAT Q3 earnings", dateStart: "2026-11-17" }),
    ];
    const dens = catalystDensity(cats, { asOf: "2026-11-01" });
    expect(dens.length).toBe(3); // three per-ticker clusters before merging
    const merged = mergeSharedClusters(dens);
    expect(merged).toHaveLength(1);
    const m = merged[0]!;
    expect(m.events.map((e) => e.id)).toEqual(["bis", "amd-e", "nvda-e", "amat-e"]); // union, dedupe by id
    expect(m.start).toBe("2026-11-03"); // span = min start..max end
    expect(m.end).toBe("2026-11-17");
    expect(m.score).toBe(Math.max(...dens.map((d) => d.score))); // score = max
    expect(m.affectedTickers).toEqual(["NVDA", "AMD", "AMAT"]); // union of affected tickers
    expect(m.kinds).toEqual(["rule_effective", "earnings"]);
  });

  it("does not merge clusters that share no tickerless catalyst", () => {
    const cats = [
      cat({ id: "n1", ticker: "NVDA", title: "NVDA earnings", dateStart: "2026-11-04" }),
      cat({ id: "n2", ticker: "NVDA", title: "NVDA conference", kind: "conference", dateStart: "2026-11-04" }),
      cat({ id: "a1", ticker: "AMD", title: "AMD earnings", dateStart: "2026-11-04" }),
      cat({ id: "a2", ticker: "AMD", title: "AMD conference", kind: "conference", dateStart: "2026-11-04" }),
    ];
    const merged = mergeSharedClusters(catalystDensity(cats, { asOf: "2026-11-01" }));
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.events.map((e) => e.id))).toEqual([["n1", "n2"], ["a1", "a2"]]);
  });
});

describe("renderCalendarPage policy filter", () => {
  it("hide=policy removes policy rows, keeps earnings, and renders the Policy pill", () => {
    const cats = [
      cat({ id: "pe", ticker: "NVDA", title: "NVDA earnings" }),
      cat({ id: "pp", ticker: "AMD", title: "Rule effective", kind: "rule_effective", dedupeKey: "policy:rule-1" }),
    ];
    const base = renderCalendarPage({ cats, asOf: "2026-11-01", all: true });
    expect(base).toContain("NVDA earnings");
    expect(base).toContain("Rule effective");
    expect(base).toContain(">✓ Policy</a>");
    const noPolicy = renderCalendarPage({ cats, asOf: "2026-11-01", all: true, hide: "policy" });
    expect(noPolicy).toContain("NVDA earnings");
    expect(noPolicy).not.toContain("Rule effective");
  });
});
