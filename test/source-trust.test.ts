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
});