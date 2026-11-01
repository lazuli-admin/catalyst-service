import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRelevant, topicTags, type FrDoc } from "../src/topics.js";

interface LabeledDoc {
  document_number: string;
  agency: string;
  type: string;
  title: string;
  abstract: string;
  relevant: boolean;
  reason: string;
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/fr-labeled.json", import.meta.url), "utf8")) as unknown as LabeledDoc[];
const toFrDoc = (d: LabeledDoc): FrDoc => ({
  title: d.title,
  abstract: d.abstract,
  type: d.type,
  agency: d.agency,
  documentNumber: d.document_number,
});

describe("topics", () => {
  it("recall and precision of isRelevant vs labeled fixture", () => {
    expect(fixture.length).toBeGreaterThanOrEqual(140);
    expect(fixture.some((d) => d.relevant)).toBe(true);
    expect(fixture.some((d) => !d.relevant)).toBe(true);

    const docs = fixture.map(toFrDoc);
    const fn = docs.filter((d, i) => fixture[i]!.relevant && !isRelevant(d));
    const fp = docs.filter((d, i) => !fixture[i]!.relevant && isRelevant(d));

    const relevantCount = fixture.filter((d) => d.relevant).length;
    const recall = (relevantCount - fn.length) / relevantCount;
    const precision = (relevantCount - fn.length) / (relevantCount - fn.length + fp.length);

    console.log(`recall=${recall.toFixed(3)} precision=${precision.toFixed(3)} (FN=${fn.length} FP=${fp.length})`);
    for (const d of fn) console.log(`FN ${d.documentNumber}: ${d.title}`);
    for (const d of fp) console.log(`FP ${d.documentNumber}: ${d.title}`);

    expect(recall).toBeGreaterThanOrEqual(0.95);
    expect(precision).toBeGreaterThanOrEqual(0.8);
  });

  it("isRelevant and topicTags are agency-invariant", () => {
    const agencies = ["BIS", "USTR", "FTC", "FCC", "ITA", "CBP", "SEC"];
    for (const d of fixture) {
      const base = toFrDoc(d);
      const baseRel = isRelevant(base);
      const baseTags = topicTags(base);
      for (const agency of agencies) {
        const doc: FrDoc = { ...base, agency };
        expect(isRelevant(doc), `isRelevant mismatch for ${d.document_number} with agency ${agency}`).toBe(baseRel);
        expect(topicTags(doc), `topicTags mismatch for ${d.document_number} with agency ${agency}`).toEqual(baseTags);
      }
    }
  });

  it("critical minerals", () => {
    const fixtureDoc = fixture.find((d) => d.document_number === "2026-16078");
    expect(fixtureDoc).toBeDefined();
    expect(isRelevant(toFrDoc(fixtureDoc!))).toBe(true);

    const doc: FrDoc = { title: "Request for Comments on Critical Minerals Trade" };
    expect(isRelevant({ ...doc, agency: "BIS" })).toBe(true);
    expect(isRelevant({ ...doc, agency: "USTR" })).toBe(true);
    expect(topicTags(doc).topics).toContain("critical-minerals");
  });

  it("known irrelevant docs", () => {
    const transferAgent = fixture.find((d) => d.document_number === "2026-18190");
    expect(transferAgent).toBeDefined();
    expect(isRelevant(toFrDoc(transferAgent!))).toBe(false);

    const petitions = fixture.filter((d) => d.agency === "FTC" && /petition for rulemaking/i.test(d.title));
    expect(petitions.length).toBeGreaterThan(0);
    for (const p of petitions) expect(isRelevant(toFrDoc(p))).toBe(false);

    expect(isRelevant({ title: "Certain Steel Nails From Malaysia: Preliminary Results and Rescission, in Part, of Antidumping Duty Administrative Review; 2024-2025" })).toBe(false);
    expect(isRelevant({ title: "Section 232 Inclusions Process for Steel Derivatives" })).toBe(true);

    const silencers = fixture.find((d) => d.document_number === "2026-14942");
    expect(silencers).toBeDefined();
    expect(isRelevant(toFrDoc(silencers!))).toBe(false);

    expect(isRelevant({ title: "Section 232 Steel Tariffs; Correction" })).toBe(false);
  });
});
