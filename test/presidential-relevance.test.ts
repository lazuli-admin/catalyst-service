import { describe, expect, it } from "vitest";
import { isRelevant, topicTags } from "../src/topics.js";

// Presidential documents are kept by default: relevance needs no topic match,
// only absence of ceremony (CEREMONIAL_PRESIDENTIAL_RE).

describe("presidential keep-by-default", () => {
  it("keeps substantive presidential documents without a topic", () => {
    const kept = [
      "Excluding Certain Canadian Products From Importation Into the United States in Response to Continued Discrimination Against American Alcoholic Beverages",
      "Ensuring Affordable Beef for the American Consumer",
      "Ushering in the Next Frontier of Quantum Innovation",
    ];
    for (const title of kept) {
      expect(isRelevant({ title, type: "Presidential Document" })).toBe(true);
    }
  });

  it("gives kept presidential docs no importance boost (topics may be empty)", () => {
    const doc = { title: "Ensuring Affordable Beef for the American Consumer", type: "Presidential Document" };
    expect(isRelevant(doc)).toBe(true);
    expect(topicTags(doc).affectedTickers).toEqual([]);
  });

  it("drops ceremonial presidential documents", () => {
    const dropped = [
      "National Example Awareness Month, 2026",
      "National Day of Prayer, 2026",
      "Honoring the Victims of the Example Tragedy",
      "Death of Example Person",
      "Anniversary of the Example Treaty",
      "Providing for the Closing of Executive Departments and Agencies of the Federal Government on December 26, 2026",
      "Flags at Half-Staff in Memory of Example Person",
    ];
    for (const title of dropped) {
      expect(isRelevant({ title, type: "Presidential Document" })).toBe(false);
    }
  });

  it("applies the continuation rule to presidential documents", () => {
    expect(isRelevant({ title: "Continuation of the National Emergency With Respect to Example Country", type: "Presidential Document" })).toBe(false);
    expect(isRelevant({ title: "Continuation of the National Emergency With Respect to Example Country and Expansion of Scope", type: "Presidential Document" })).toBe(true);
  });

  it("does not make ceremonial titles of other types relevant (topic still required)", () => {
    expect(isRelevant({ title: "National Day of Prayer, 2026", type: "Notice" })).toBe(false);
    expect(isRelevant({ title: "Flags at Half-Staff in Memory of Example Person", type: "Notice" })).toBe(false);
  });

  it("still requires a topic for non-presidential documents", () => {
    expect(isRelevant({ title: "Ushering in the Next Frontier of Quantum Innovation", type: "Notice" })).toBe(false);
  });
});
