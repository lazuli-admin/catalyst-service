import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNoise, isRelevant, topicTags } from "../src/topics.js";
import type { FrDoc } from "../src/topics.js";

interface FrRegressionRow {
  document_number: string;
  title: string;
  abstract: string;
  agency: string;
  relevant: number;
  reason: string;
}

const rows: FrRegressionRow[] = JSON.parse(
  readFileSync(new URL("./fixtures/fr-regression.json", import.meta.url), "utf8"),
) as FrRegressionRow[];

describe("fr-regression fixtures", () => {
  it("has at least 13 labeled documents", () => {
    expect(rows.length).toBeGreaterThanOrEqual(13);
  });

  it("every labeled document is relevant", () => {
    for (const row of rows) {
      const doc: FrDoc = {
        title: row.title,
        abstract: row.abstract,
        documentNumber: row.document_number,
      };
      expect(isRelevant(doc), `${row.document_number} should be relevant`).toBe(true);
    }
  });

  it("2026-20615 is tagged carbon-border-eu-trade", () => {
    const row = rows.find((r) => r.document_number === "2026-20615");
    expect(row).toBeDefined();
    const topics = topicTags({ title: row!.title, abstract: row!.abstract }).topics;
    expect(topics).toContain("carbon-border-eu-trade");
  });

  it("2025-19846 is tagged semis-export-controls", () => {
    const row = rows.find((r) => r.document_number === "2025-19846");
    expect(row).toBeDefined();
    const topics = topicTags({ title: row!.title, abstract: row!.abstract }).topics;
    expect(topics).toContain("semis-export-controls");
  });
});

describe("topic matching uses abstract; noise uses title only", () => {
  it("matches on abstract", () => {
    expect(isRelevant({ title: "Notice", abstract: "rare earth magnets" })).toBe(true);
  });

  it("isNoise ignores abstract", () => {
    expect(isNoise({ title: "Some rule", abstract: "information collection" })).toBe(false);
  });
});
