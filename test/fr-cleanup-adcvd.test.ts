import { describe, expect, it } from "vitest";
import { isNoise, isRelevant } from "../src/topics.js";

const doc = (title: string) => ({ title });

describe("AD/CVD procedural notices", () => {
  it("postponement-only titles are noise", () => {
    expect(
      isNoise(doc("Certain Steel Nails From Vietnam: Postponement of Preliminary Determination in the Less-Than-Fair-Value Investigation")),
    ).toBe(true);
    expect(
      isNoise(doc("Brass Rod From India: Postponement of Final Determination in the Countervailing Duty Investigation")),
    ).toBe(true);
  });

  it("petition adequacy deadline extensions are noise", () => {
    expect(
      isNoise(doc("Certain Paper Plates From Thailand: Extension of Deadline for Determining the Adequacy of the Antidumping Duty Petition")),
    ).toBe(true);
  });

  it("combined determination + postponement titles are kept", () => {
    const title =
      "Certain Paper Plates From Thailand: Preliminary Affirmative Determination of Sales at Less Than Fair Value, Postponement of Final Determination, and Extension of Provisional Measures";
    expect(isNoise(doc(title))).toBe(false);
    expect(isRelevant(doc(title))).toBe(true);
  });

  it("orders and determinations stay relevant", () => {
    expect(isRelevant(doc("Silicon Metal From Angola: Antidumping Duty Order"))).toBe(true);
    expect(isRelevant(doc("Silicon Metal From Angola: Final Affirmative Countervailing Duty Determination"))).toBe(true);
  });
});