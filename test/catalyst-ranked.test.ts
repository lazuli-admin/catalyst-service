import { describe, expect, it } from "vitest";
import { rankCatalysts } from "../src/catalysts/ranked.js";
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
  it("scores weight x certainty x lead-time x confidence and sorts by score desc then date", () => {
    const rows = rankCatalysts(
      [cat({ id: "a" }), cat({ id: "b", dateStart: "2026-03-20", dateEnd: "2026-03-24", datePrecision: "window", confidence: 0.5 }), cat({ id: "c", kind: "regulatory_decision" })],
      { asOf: TODAY },
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(rows[1]!.score).toBeCloseTo(3 * 1 * 1 * 1);
    expect(rows[2]!.score).toBeCloseTo(3 * 0.7 * 1 * 0.5);
    expect(rows[1]!.bucket).toBe("actionable");
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
      { asOf: TODAY },
    );
    expect(rows).toHaveLength(0);
    expect(rankCatalysts([cat({ id: "keep", ticker: null, kind: "macro" })], { asOf: TODAY, all: true })).toHaveLength(1);
  });
});
