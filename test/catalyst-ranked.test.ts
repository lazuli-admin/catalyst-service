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
      { asOf: TODAY, watchlist: [] },
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
      { asOf: TODAY, watchlist: [] },
    );
    expect(rows).toHaveLength(0);
    expect(rankCatalysts([cat({ id: "keep", ticker: null, kind: "macro" })], { asOf: TODAY, all: true })).toHaveLength(1);
  });

  it("focus watchlist tickers get score x2 and focus: true (ticker or affectedTicker)", () => {
    const plain = rankCatalysts([cat({ ticker: "SMOL" }), cat({ ticker: null, affectedTickers: ["DOCN"] })], { asOf: TODAY, watchlist: [] });
    expect(plain.every((r) => !r.focus)).toBe(true);
    const rows = rankCatalysts([cat({ ticker: "SMOL" }), cat({ ticker: null, affectedTickers: ["DOCN"] })], { asOf: TODAY });
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

  it("implied move scales earnings score by clamp(im/0.05, 0.5, 3)", () => {
    const base = rankCatalysts([cat({ ticker: "NVDA" })], { asOf: TODAY, watchlist: [] })[0]!.score;
    const mv = rankCatalysts(
      [
        cat({ ticker: "NVDA" }),
        cat({ ticker: "SMOL", id: "s1" }),
        cat({ ticker: "AAPL", id: "s2" }),
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
