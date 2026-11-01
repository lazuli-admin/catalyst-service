import { describe, expect, it } from "vitest";
import { catalystDensity } from "../src/catalysts/density.js";
import { memoryStore } from "./helpers.js";
import type { Catalyst } from "../src/types.js";

const base: Omit<Catalyst, "id" | "createdAt" | "updatedAt"> = {
  ticker: "NVDA",
  title: "Q4 earnings call",
  kind: "earnings",
  status: "scheduled",
  dateStart: "2025-03-01",
  dateEnd: "2025-03-01",
  datePrecision: "exact",
  confidence: 0.9,
  sourceTier: 1,
  themes: ["ai"],
  affectedTickers: ["NVDA"],
  sourceUrl: null,
  observationId: null,
  dedupeKey: "nvda-q4-2025",
};

describe("catalysts db", () => {
  it("inserts and upserts by dedupeKey", async () => {
    const store = await memoryStore();
    const a = await store.upsertCatalyst(base);
    expect(a.id).toBeTruthy();
    expect(a.dedupeKey).toBe(base.dedupeKey);

    const b = await store.upsertCatalyst({ ...base, status: "confirmed", confidence: 1 });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe("confirmed");
    expect(b.confidence).toBe(1);
    const list = await store.listCatalysts({ from: "2025-01-01", to: "2025-12-31" });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(a.id);
  });

  it("upsert updates title at equal tier, keeps old title at worse tier", async () => {
    const store = await memoryStore();
    const a = await store.upsertCatalyst({ ...base, title: "FOMC meeting" });
    const b = await store.upsertCatalyst({ ...base, title: "FOMC renamed" });
    expect(b.id).toBe(a.id);
    expect(b.title).toBe("FOMC renamed");

    const c = await store.upsertCatalyst({ ...base, title: "FOMC worse tier", sourceTier: 2 });
    expect(c.id).toBe(a.id);
    expect(c.title).toBe("FOMC renamed");
  });

  it("filters by window, ticker and theme", async () => {
    const store = await memoryStore();
    await store.upsertCatalyst(base);
    await store.upsertCatalyst({ ...base, dedupeKey: "amd-earnings", ticker: "AMD", affectedTickers: ["AMD"], dateStart: "2025-02-01", dateEnd: "2025-02-01", themes: ["ai", "semis"] });
    await store.upsertCatalyst({ ...base, dedupeKey: "macro-cpi", ticker: null, affectedTickers: [], dateStart: "2025-04-01", dateEnd: "2025-04-05", kind: "macro", themes: [] });

    expect(await store.listCatalysts({ from: "2025-03-01", to: "2025-03-02" })).toHaveLength(1);
    expect(await store.listCatalysts({ from: "2025-04-03", to: "2025-04-03" })).toHaveLength(1);
    const nvda = await store.listCatalysts({ from: "2025-01-01", to: "2025-12-31", ticker: "NVDA" });
    expect(nvda).toHaveLength(1);
    const amd = await store.listCatalysts({ from: "2025-01-01", to: "2025-12-31", ticker: "AMD" });
    expect(amd).toHaveLength(1);
    const semis = await store.listCatalysts({ from: "2025-01-01", to: "2025-12-31", theme: "semis" });
    expect(semis).toHaveLength(1);
    expect(semis[0]!.ticker).toBe("AMD");
  });

  it("excludes cancelled by default", async () => {
    const store = await memoryStore();
    await store.upsertCatalyst(base);
    await store.upsertCatalyst({ ...base, dedupeKey: "call-cancelled", status: "cancelled" });
    expect(await store.listCatalysts({ from: "2025-01-01", to: "2025-12-31" })).toHaveLength(1);
    expect(await store.listCatalysts({ from: "2025-01-01", to: "2025-12-31", includeCancelled: true })).toHaveLength(2);
  });

  it("excludes leads by default; includeLeads reveals them, and density never sees them", async () => {
    const store = await memoryStore();
    await store.upsertCatalyst(base);
    await store.upsertCatalyst({ ...base, dedupeKey: "reuters-lead", status: "lead" });
    expect(await store.listCatalysts({ from: "2025-01-01", to: "2025-12-31" })).toHaveLength(1);
    const leads = await store.listCatalysts({ from: "2025-01-01", to: "2025-12-31", includeLeads: true });
    expect(leads).toHaveLength(2);
    expect(leads[1]!.status).toBe("lead");
    expect(catalystDensity(await store.listCatalysts({ from: "2025-01-01", to: "2025-12-31" }), { asOf: "2025-01-01" })).toHaveLength(1);
    // This test is verifying that leads are filtered out by density function
    const densityWithLeads = catalystDensity(leads, { asOf: "2025-01-01" });
    expect(densityWithLeads).toHaveLength(1);
    expect(densityWithLeads[0]!.ticker).toBe("NVDA");
  });

  it("purgeStaleCatalysts deletes only matching kind, on/after the from date, updated before the cutoff", async () => {
    const store = await memoryStore();
    await store.upsertCatalyst({ ...base, kind: "rule_effective", dateStart: "2025-11-09", dedupeKey: "fr:old" });
    await store.upsertCatalyst({ ...base, kind: "rule_effective", dateStart: "2026-11-10", dedupeKey: "fr:fresh" });
    await store.upsertCatalyst({ ...base, kind: "earnings", dateStart: "2026-11-10", dedupeKey: "nvda-q4" });
    // Cutoff in the past: everything was updated after it, so nothing is stale.
    expect(await store.purgeStaleCatalysts("rule_effective", "2026-11-01", "2000-01-01T00:00:00.000Z", "fr:")).toBe(0);
    // Real cutoff: deletes the fresh-in-window rule row, keeps the old-dated one and the other kind.
    expect(await store.purgeStaleCatalysts("rule_effective", "2026-11-01", "2999-01-01T00:00:00.000Z", "fr:")).toBe(1);
    expect(await store.listCatalysts({ from: "2025-01-01", to: "2027-12-31" })).toHaveLength(2);
  });

  it("purgeStaleCatalysts spares rule rows whose dedupe key lacks the given prefix", async () => {
    const store = await memoryStore();
    await store.upsertCatalyst({ ...base, kind: "rule_effective", dateStart: "2026-11-10", dedupeKey: "news:rule" });
    expect(await store.purgeStaleCatalysts("rule_effective", "2026-11-01", "2999-01-01T00:00:00.000Z", "fr:")).toBe(0);
    expect(await store.listCatalysts({ from: "2025-01-01", to: "2027-12-31" })).toHaveLength(1);
  });
});
