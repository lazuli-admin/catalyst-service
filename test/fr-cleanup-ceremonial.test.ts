import { describe, expect, it } from "vitest";
import { isRelevant } from "../src/topics.js";

describe("ceremonial presidential negative list", () => {
  it("drops ceremonial commemorative titles", () => {
    const dropped = [
      "Martin Luther King, Jr., Federal Holiday, 2026",
      "Columbus Day, 2026",
      "Veterans Day, 2026",
      "Patriot Day, 2026",
    ];
    for (const title of dropped) {
      expect(isRelevant({ title, type: "Presidential Document" })).toBe(false);
    }
  });

  it("keeps substantive presidential documents", () => {
    const kept = [
      "Adjusting Imports of Steel Into the United States",
      "Unleashing American Energy",
      "Establishing the United States Space Academy",
    ];
    for (const title of kept) {
      expect(isRelevant({ title, type: "Presidential Document" })).toBe(true);
    }
  });
});
