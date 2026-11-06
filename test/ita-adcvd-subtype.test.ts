import { describe, expect, it } from "vitest";
import { isNoise, isRelevant, itaAdCvdSubtype, type FrDoc } from "../src/topics.js";

const doc = (title: string, opts: Partial<FrDoc> = {}): FrDoc => ({
  title,
  type: "Notice",
  agencyLabel: "ITA",
  ...opts,
});

describe("ITA AD/CVD subtype: scope", () => {
  it("applies only to ITA docs of type Notice/Rule/Proposed Rule (or absent type)", () => {
    for (const type of ["Notice", "Rule", "Proposed Rule", undefined]) {
      expect(itaAdCvdSubtype(doc("Silicon Metal From Angola: Antidumping Duty Order", { type }))).toBe("keep");
    }
    expect(itaAdCvdSubtype(doc("x", { type: "Presidential Document" }))).toBeNull();
  });

  it("requires a generic AD/CVD trade-remedy subject, not a blanket ITA rule", () => {
    expect(itaAdCvdSubtype(doc("Import Administration: Notice of a Public Meeting on Steel"))).toBeNull();
    expect(itaAdCvdSubtype(doc("Export of Horses for Slaughter; Inspection Fee"))).toBeNull();
  });
});

describe("ITA AD/CVD subtype: keep", () => {
  const keeps: Array<[string, string | undefined]> = [
    // new orders
    ["Silicon Metal From Angola: Antidumping Duty Order", undefined],
    ["Fresh Garlic From China: Countervailing Duty Order", undefined],
    // preliminary/final determinations WITH an affirmative/negative adjective
    ["Brass Rod From India: Final Affirmative Countervailing Duty Determination", undefined],
    ["Certain Steel Nails From Vietnam: Negative Preliminary Determination of the Antidumping Duty Investigation", undefined],
    // ...and WITHOUT an affirmative/negative adjective
    ["Certain Paper Plates From Thailand: Preliminary Determination of Sales at Less Than Fair Value", undefined],
    ["Frozen Fish Fillets From Vietnam: Final Determination of Sales at Less Than Fair Value", undefined],
    // reinstatement keeps even when paired with review-results noise words
    ["Certain Carbon Steel Products: Amended Final Results of the Antidumping Duty Administrative Review and Reinstatement of Cash Deposit Requirements", undefined],
    // actual order amendment (without reinstatement)
    ["Carbon Steel Butt-Weld Pipe Fittings From Thailand: Amended Antidumping Duty Order", undefined],
    // mixed: an actual determination announcement plus a postponement
    [
      "Certain Paper Plates From Thailand: Preliminary Affirmative Determination of Sales at Less Than Fair Value, Postponement of Final Determination, and Extension of Provisional Measures",
      undefined,
    ],
  ];
  for (const [title, action] of keeps) {
    it(`keep: ${title}`, () => {
      const d = doc(title, { action });
      expect(itaAdCvdSubtype(d)).toBe("keep");
      expect(isNoise(d)).toBe(false);
      expect(isRelevant(d)).toBe(true);
    });
  }

  it("the action field alone can carry the decision (title+action combined)", () => {
    expect(itaAdCvdSubtype(doc("Brass Rod From India: Countervailing Duty Investigation", { action: "Final affirmative countervailing duty determination" }))).toBe("keep");
    expect(itaAdCvdSubtype(doc("Brass Rod From India: Countervailing Duty Investigation", { action: "Postponement of final determination" }))).toBe("noise");
  });

  it("repeated sole postponements across title and action are noise (every occurrence erased)", () => {
    const d = doc(
      "Certain Steel Nails From Vietnam: Postponement of Preliminary Determination in the Less-Than-Fair-Value Investigation",
      { action: "Postponement of preliminary determination; postponement of final determination." },
    );
    expect(itaAdCvdSubtype(d)).toBe("noise");
    expect(isNoise(d)).toBe(true);
    expect(isRelevant(d)).toBe(false);
  });
});

describe("ITA AD/CVD subtype: noise", () => {
  const noise: Array<[string, string | undefined]> = [
    ["Certain Carbon Steel Products: Final Results of the Antidumping Duty Administrative Review", undefined],
    ["Polyvinyl Alcohol From China: Initiation and Final Results of Sunset Review of the Antidumping Duty Administrative Review", undefined],
    // sole postponements
    ["Certain Steel Nails From Vietnam: Postponement of Preliminary Determination in the Less-Than-Fair-Value Investigation", undefined],
    ["Brass Rod From India: Postponement of Final Determination in the Countervailing Duty Investigation", undefined],
    // sole petition-adequacy deadline extension
    ["Certain Paper Plates From Thailand: Extension of Deadline for Determining the Adequacy of the Antidumping Duty Petition", undefined],
    // amended final results WITHOUT reinstatement stay routine review noise
    ["Certain Carbon Steel Products: Amended Final Results of the Antidumping Duty Administrative Review", undefined],
  ];
  for (const [title, action] of noise) {
    it(`noise: ${title}`, () => {
      const d = doc(title, { action });
      expect(itaAdCvdSubtype(d)).toBe("noise");
      expect(isNoise(d)).toBe(true);
      expect(isRelevant(d)).toBe(false);
    });
  }
});

describe("ITA AD/CVD subtype: controls", () => {
  it("other agencies keep existing behavior (global noise list decides)", () => {
    const title = "Certain Steel Nails From Vietnam: Postponement of Preliminary Determination in the Less-Than-Fair-Value Investigation";
    expect(itaAdCvdSubtype(doc(title, { agencyLabel: "BIS" }))).toBeNull();
    expect(isNoise(doc(title, { agencyLabel: "BIS" }))).toBe(true);
  });

  it("correction documents are never rescued by the subtype", () => {
    const d = doc("Certain Carbon Steel Products: Amended Final Results of the Antidumping Duty Administrative Review and Reinstatement", {
      documentNumber: "C3-2025-01234",
    });
    expect(itaAdCvdSubtype(d)).toBe("keep");
    expect(isNoise(d)).toBe(true);
    expect(isRelevant(d)).toBe(false);
  });

  it("the OMB generic guard is not bypassed by the subtype", () => {
    const d = doc("Silicon Metal From Angola: Antidumping Duty Order", {
      action: "Final rule; announcement of effective date.",
      abstract: "The information collection requirements have been submitted to OMB for review.",
    });
    expect(itaAdCvdSubtype(d)).toBe("keep");
    expect(isRelevant(d)).toBe(false); // OMB guard fires despite the keep subtype
  });

  it("Section 232 titles keep the AD/CVD-skip exception even when the subtype says noise", () => {
    const d = doc("Section 232 Steel Nails: Final Results of the Antidumping Duty Administrative Review");
    expect(itaAdCvdSubtype(d)).toBe("noise"); // helper still classifies it as routine review noise...
    expect(isNoise(d)).toBe(false); // ...but the Section 232 exception overrides, as before the helper existed
    expect(isRelevant(d)).toBe(true); // kept via the tariffs (301/232) topic
  });

  it("positive control: an actual AD/CVD order under a Section 232 title still keeps", () => {
    const d = doc("Section 232 Steel Derivatives: Antidumping Duty Order");
    expect(itaAdCvdSubtype(d)).toBe("keep");
    expect(isNoise(d)).toBe(false);
    expect(isRelevant(d)).toBe(true);
  });

  it("SEC helper is preserved alongside the ITA helper", () => {
    expect(isRelevant(doc("Self-Regulatory Organizations; NYSE; Proposed Rule Change To Establish New Listing Standards", { agencyLabel: "SEC" }))).toBe(true);
  });
});

