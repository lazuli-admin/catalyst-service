import { describe, expect, it } from "vitest";
import { enforceTrust, isWireSource, sourceTier } from "../src/catalysts/credibility.js";
import { memoryStore } from "./helpers.js";
import type { Catalyst } from "../src/types.js";

describe("source trust", () => {
  it("identifies wire sources correctly", () => {
    expect(isWireSource("https://www.prnewswire.com/news-releases/some-news-123456789.html")).toBe(true);
    expect(isWireSource("https://www.businesswire.com/news/home/20240101000000/en/Some-News")).toBe(true);
    expect(isWireSource("https://globenewswire.com/press-release/some-news-123456789.html")).toBe(true);
    expect(isWireSource("https://accesswire.com/news/some-news-123456789.html")).toBe(true);
    expect(isWireSource("https://newsfilecorp.com/press-release/some-news-123456789.html")).toBe(true);
    expect(isWireSource("https://notprnewswire.com/news/some-news-123456789.html")).toBe(false);
  });

  it("assigns correct tiers to wire sources", () => {
    expect(sourceTier({ url: "https://www.prnewswire.com/news-releases/some-news-123456789.html" })).toBe(2);
    expect(sourceTier({ url: "https://www.businesswire.com/news/home/20240101000000/en/Some-News" })).toBe(2);
    expect(sourceTier({ url: "https://globenewswire.com/press-release/some-news-123456789.html" })).toBe(2);
    expect(sourceTier({ url: "https://accesswire.com/news/some-news-123456789.html" })).toBe(2);
    expect(sourceTier({ url: "https://newsfilecorp.com/press-release/some-news-123456789.html" })).toBe(2);
  });

  it("upsert with caller sourceTier 1 and a wire URL stores sourceTier 2", async () => {
    const store = await memoryStore();
    const catalyst: Omit<Catalyst, "id" | "createdAt" | "updatedAt"> = {
      ticker: "NVDA",
      title: "Some news",
      kind: "earnings",
      status: "scheduled",
      dateStart: "2025-03-01",
      dateEnd: "2025-03-01",
      datePrecision: "exact",
      confidence: 0.9,
      sourceTier: 1,
      themes: ["ai"],
      affectedTickers: ["NVDA"],
      sourceUrl: "https://www.prnewswire.com/news-releases/some-news-123456789.html",
      observationId: null,
      dedupeKey: "nvda-some-news",
    };

    const result = await store.upsertCatalyst(catalyst);
    expect(result.sourceTier).toBe(2); // Should be overridden to tier 2 due to wire source
  });

  it("upsert with caller sourceTier 3 and a .gov URL stores 1", async () => {
    const store = await memoryStore();
    const catalyst: Omit<Catalyst, "id" | "createdAt" | "updatedAt"> = {
      ticker: "NVDA",
      title: "Some news",
      kind: "earnings",
      status: "scheduled",
      dateStart: "2025-03-01",
      dateEnd: "2025-03-01",
      datePrecision: "exact",
      confidence: 0.9,
      sourceTier: 3,
      themes: ["ai"],
      affectedTickers: ["NVDA"],
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1018724/000162828024002399/tsla-20231231.htm",
      observationId: null,
      dedupeKey: "nvda-some-news",
    };

    const result = await store.upsertCatalyst(catalyst);
    expect(result.sourceTier).toBe(1); // Should be overridden to tier 1 due to .gov source
  });

  it("wire URL + kind regulatory_decision + status confirmed is stored as kind 'other', status 'lead'", async () => {
    const store = await memoryStore();
    const catalyst: Omit<Catalyst, "id" | "createdAt" | "updatedAt"> = {
      ticker: "NVDA",
      title: "Some regulatory decision",
      kind: "regulatory_decision",
      status: "confirmed",
      dateStart: "2025-03-01",
      dateEnd: "2025-03-01",
      datePrecision: "exact",
      confidence: 0.9,
      sourceTier: 2,
      themes: ["ai"],
      affectedTickers: ["NVDA"],
      sourceUrl: "https://www.prnewswire.com/news-releases/some-news-123456789.html",
      observationId: null,
      dedupeKey: "x:1", // Non-legacy key
    };

    const result = await store.upsertCatalyst(catalyst);
    expect(result.kind).toBe("other");
    expect(result.status).toBe("lead");
  });

  it("federalregister.gov URL regulatory_decision confirmed with key 'fr:2026-00001:2026-11-10' stays regulatory_decision/confirmed/tier 1", async () => {
    const store = await memoryStore();
    const catalyst: Omit<Catalyst, "id" | "createdAt" | "updatedAt"> = {
      ticker: "NVDA",
      title: "Some regulatory decision",
      kind: "regulatory_decision",
      status: "confirmed",
      dateStart: "2025-03-01",
      dateEnd: "2025-03-01",
      datePrecision: "exact",
      confidence: 0.9,
      sourceTier: 2,
      themes: ["ai"],
      affectedTickers: ["NVDA"],
      sourceUrl: "https://www.federalregister.gov/documents/2024/01/01/2024-00001/some-rule",
      observationId: null,
      dedupeKey: "fr:2026-00001:2026-11-10",
    };

    const result = await store.upsertCatalyst(catalyst);
    expect(result.kind).toBe("regulatory_decision");
    expect(result.status).toBe("confirmed");
    expect(result.sourceTier).toBe(1);
  });

  it("upsert overwrites a stale row's tier/kind/source_url (no MIN-tier preference)", async () => {
    const store = await memoryStore();
    const dedupeKey = "fr:9999-00001:2026-11-20";
    // Simulate a stale row written before trust enforcement: tier 1 regulatory_decision from a wire URL.
    await store.client.execute(
      `INSERT INTO catalysts (id, ticker, title, kind, status, date_start, date_end, date_precision, confidence, themes, affected_tickers, source_tier, source_url, dedupe_key, created_at, updated_at)
       VALUES ('c1', 'NVDA', 'Old title', 'regulatory_decision', 'confirmed', '2026-11-20', '2026-11-20', 'exact', 0.9, '[]', '[]', 1, 'https://www.businesswire.com/news/x', ?, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`,
      [dedupeKey],
    );
    const result = await store.upsertCatalyst({
      ticker: "NVDA",
      title: "Some regulatory decision",
      kind: "regulatory_decision",
      status: "confirmed",
      dateStart: "2026-11-20",
      dateEnd: "2026-11-20",
      datePrecision: "exact",
      confidence: 0.9,
      sourceTier: 2,
      themes: ["ai"],
      affectedTickers: ["NVDA"],
      sourceUrl: "https://www.businesswire.com/news/x",
      observationId: null,
      dedupeKey,
    });
    expect(result.sourceTier).toBe(2);
    expect(result.kind).toBe("other");
    expect(result.status).toBe("lead");
  });

  it("recomputeTrust downgrades a stale tier-1 regulatory_decision row with a legacy key", async () => {
    const store = await memoryStore();
    await store.client.execute(
      `INSERT INTO catalysts (id, ticker, title, kind, status, date_start, date_end, date_precision, confidence, themes, affected_tickers, source_tier, source_url, dedupe_key, created_at, updated_at)
       VALUES ('c1', 'NVDA', 'Old title', 'regulatory_decision', 'confirmed', '2026-11-20', '2026-11-20', 'exact', 0.9, '[]', '[]', 1, 'https://www.prnewswire.com/news-releases/some-news-123456789.html', '-|regulatory_decision|2026-11|natura resources joins texas a m', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`,
    );
    const changes = await store.recomputeTrust();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: "c1", dedupeKey: "-|regulatory_decision|2026-11|natura resources joins texas a m", from: { tier: 1, kind: "regulatory_decision", status: "confirmed" }, to: { tier: 2, kind: "other", status: "lead" } });
    // The row is repaired in place, never deleted.
    const remaining = await store.client.execute("SELECT COUNT(*) AS n FROM catalysts");
    expect(Number(remaining.rows[0]!.n)).toBe(1);
    // Idempotent: a second pass finds nothing left to change.
    expect(await store.recomputeTrust()).toEqual([]);
  });

  it("recomputeTrust leaves a tier-1 federalregister.gov row unchanged", async () => {
    const store = await memoryStore();
    await store.client.execute(
      `INSERT INTO catalysts (id, ticker, title, kind, status, date_start, date_end, date_precision, confidence, themes, affected_tickers, source_tier, source_url, dedupe_key, created_at, updated_at)
       VALUES ('c1', 'NVDA', 'Some rule', 'regulatory_decision', 'confirmed', '2026-11-20', '2026-11-20', 'exact', 0.9, '[]', '[]', 1, 'https://www.federalregister.gov/documents/2024/01/01/2024-00001/some-rule', 'fr:2026-00001:2026-11-20', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`,
    );
    expect(await store.recomputeTrust()).toEqual([]);
  });

  it("regulatory_decision with legacy key '-|regulatory_decision|2026-01|some title' rejects", async () => {
    const store = await memoryStore();
    const catalyst: Omit<Catalyst, "id" | "createdAt" | "updatedAt"> = {
      ticker: "NVDA",
      title: "Some regulatory decision",
      kind: "regulatory_decision",
      status: "confirmed",
      dateStart: "2025-03-01",
      dateEnd: "2025-03-01",
      datePrecision: "exact",
      confidence: 0.9,
      sourceTier: 1,
      themes: ["ai"],
      affectedTickers: ["NVDA"],
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1018724/000162828024002399/tsla-20231231.htm",
      observationId: null,
      dedupeKey: "-|regulatory_decision|2026-01|some title",
    };

    await expect(store.upsertCatalyst(catalyst)).rejects.toThrow(/rejected catalyst/);
  });

  it("enforceTrust does not mutate its input", () => {
    const input = {
      sourceUrl: "https://www.prnewswire.com/news-releases/some-news-123456789.html",
      sourceTier: 1,
      kind: "regulatory_decision",
      status: "confirmed",
      dedupeKey: "x:1",
      title: "Some news"
    };
    
    const originalInput = { ...input };
    const result = enforceTrust(input);
    
    // Ensure the input hasn't been mutated
    expect(input).toEqual(originalInput);
    expect(result).not.toBe(input);
  });

  it("merge: official FR row stays when a wire write hits the same dedupe key", async () => {
    const store = await memoryStore();
    const dedupeKey = "fr:9999-00002:2026-11-20";
    const fr = await store.upsertCatalyst({
      ticker: "NVDA", title: "Some regulatory decision", kind: "regulatory_decision", status: "confirmed",
      dateStart: "2026-11-20", dateEnd: "2026-11-20", datePrecision: "exact", confidence: 0.9,
      themes: ["ai"], affectedTickers: ["NVDA"], sourceTier: 1,
      sourceUrl: "https://www.federalregister.gov/documents/2026/01/01/9999-00002/some-decision",
      observationId: null, dedupeKey,
    });
    const wire = await store.upsertCatalyst({
      ticker: "NVDA", title: "Wire version", kind: "regulatory_decision", status: "confirmed",
      dateStart: "2026-11-20", dateEnd: "2026-11-20", datePrecision: "exact", confidence: 0.95,
      themes: ["ai"], affectedTickers: ["NVDA"], sourceTier: 2,
      sourceUrl: "https://www.businesswire.com/news/home/20261120000000/en/Some-News",
      observationId: null, dedupeKey,
    });
    expect(wire.id).toBe(fr.id);
    expect(wire.sourceTier).toBe(1);
    expect(wire.kind).toBe("regulatory_decision");
    expect(wire.status).toBe("confirmed");
    expect(wire.sourceUrl).toBe("https://www.federalregister.gov/documents/2026/01/01/9999-00002/some-decision");
    // Dates/confidence still update from the incoming row.
    expect(wire.confidence).toBe(0.95);
  });

  it("merge: an official FR write upgrades a wire row with the same dedupe key", async () => {
    const store = await memoryStore();
    const dedupeKey = "fr:9999-00002:2026-11-20";
    const wire = await store.upsertCatalyst({
      ticker: "NVDA", title: "Wire version", kind: "regulatory_decision", status: "confirmed",
      dateStart: "2026-11-20", dateEnd: "2026-11-20", datePrecision: "exact", confidence: 0.9,
      themes: ["ai"], affectedTickers: ["NVDA"], sourceTier: 2,
      sourceUrl: "https://www.businesswire.com/news/home/20261120000000/en/Some-News",
      observationId: null, dedupeKey,
    });
    expect(wire.sourceTier).toBe(2);
    expect(wire.kind).toBe("other");
    expect(wire.status).toBe("lead");
    const fr = await store.upsertCatalyst({
      ticker: "NVDA", title: "Some regulatory decision", kind: "regulatory_decision", status: "confirmed",
      dateStart: "2026-11-20", dateEnd: "2026-11-20", datePrecision: "exact", confidence: 0.9,
      themes: ["ai"], affectedTickers: ["NVDA"], sourceTier: 1,
      sourceUrl: "https://www.federalregister.gov/documents/2026/01/01/9999-00002/some-decision",
      observationId: null, dedupeKey,
    });
    expect(fr.id).toBe(wire.id);
    expect(fr.sourceTier).toBe(1);
    expect(fr.kind).toBe("regulatory_decision");
    expect(fr.status).toBe("confirmed");
    expect(fr.sourceUrl).toContain("federalregister.gov");
  });

  it("merge: stored source_tier is never trusted — poisoned tier-1 row with a wire URL loses to a wire write", async () => {
    const store = await memoryStore();
    const dedupeKey = "fr:9999-00003:2026-11-20";
    await store.client.execute(
      `INSERT INTO catalysts (id, ticker, title, kind, status, date_start, date_end, date_precision, confidence, themes, affected_tickers, source_tier, source_url, dedupe_key, created_at, updated_at)
       VALUES ('c1', 'NVDA', 'Old title', 'regulatory_decision', 'confirmed', '2026-11-20', '2026-11-20', 'exact', 0.9, '[]', '[]', 1, 'https://www.businesswire.com/news/home/20261120000000/en/Old', ?, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`,
      [dedupeKey],
    );
    const result = await store.upsertCatalyst({
      ticker: "NVDA", title: "Wire version", kind: "regulatory_decision", status: "confirmed",
      dateStart: "2026-11-20", dateEnd: "2026-11-20", datePrecision: "exact", confidence: 0.9,
      themes: ["ai"], affectedTickers: ["NVDA"], sourceTier: 1, // caller claims tier 1 — ignored
      sourceUrl: "https://www.businesswire.com/news/home/20261120000000/en/New",
      observationId: null, dedupeKey,
    });
    expect(result.sourceTier).toBe(2);
    expect(result.kind).toBe("other");
    expect(result.status).toBe("lead");
  });

  it("recomputeTrust backfills a null-URL earnings row to nasdaq.com tier 2, idempotently", async () => {
    const store = await memoryStore();
    await store.client.execute(
      `INSERT INTO catalysts (id, ticker, title, kind, status, date_start, date_end, date_precision, confidence, themes, affected_tickers, source_tier, source_url, dedupe_key, created_at, updated_at)
       VALUES ('c1', 'NVDA', 'NVIDIA earnings (bmo)', 'earnings', 'confirmed', '2026-11-20', '2026-11-20', 'exact', 0.95, '[]', '[]', 1, NULL, 'nasdaq:earnings:2026-11-20:nvda', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`,
    );
    const changes = await store.recomputeTrust();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: "c1", to: { tier: 2 } });
    const row = await store.client.execute("SELECT source_url, source_tier FROM catalysts WHERE id = 'c1'");
    expect(String(row.rows[0]!.source_url)).toBe("https://www.nasdaq.com/market-activity/earnings?date=2026-11-20");
    expect(Number(row.rows[0]!.source_tier)).toBe(2);
    expect(await store.recomputeTrust()).toEqual([]);
  });

  it("recomputeTrust replaces a fabricated EDGAR source_url on an earnings row with the Nasdaq URL and re-tiers to 2, idempotently", async () => {
    const store = await memoryStore();
    await store.client.execute(
      `INSERT INTO catalysts (id, ticker, title, kind, status, date_start, date_end, date_precision, confidence, themes, affected_tickers, source_tier, source_url, dedupe_key, created_at, updated_at)
       VALUES ('c1', 'NVDA', 'NVIDIA earnings (bmo)', 'earnings', 'confirmed', '2026-11-20', '2026-11-20', 'exact', 0.95, '[]', '[]', 1, 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NVDA&type=8-K', 'nasdaq:earnings:2026-11-20:nvda', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`,
    );
    const changes = await store.recomputeTrust();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: "c1", from: { tier: 1 }, to: { tier: 2 } });
    const row = await store.client.execute("SELECT source_url, source_tier FROM catalysts WHERE id = 'c1'");
    expect(String(row.rows[0]!.source_url)).toBe("https://www.nasdaq.com/market-activity/earnings?date=2026-11-20");
    expect(Number(row.rows[0]!.source_tier)).toBe(2);
    expect(await store.recomputeTrust()).toEqual([]);
  });
});