import { describe, expect, it } from "vitest";
import { proceduralReason, type FrApiDoc } from "../src/catalysts/fr-classify.js";
import { fccSubstantiveSubtype, isNoise, isOmbApprovalNotice, isRelevant, type FrDoc } from "../src/topics.js";

const doc = (opts: Partial<FrDoc>): FrDoc => ({ title: "", type: "Rule", agencyLabel: "FCC", ...opts });

describe("FCC substantive rule subtype: keep", () => {
  it("keeps the equipment authorization supply-chain final rule (real fields)", () => {
    const d = doc({
      title: "Protecting Against National Security Threats to the Communications Supply Chain Through the Equipment Authorization Program",
      action: "Final rule.",
      abstract: "The Commission adopts rules covering covered equipment and services to address national security threats.",
      docket_ids: ["FCC 26-51"],
    });
    expect(fccSubstantiveSubtype(d)).toBe("keep");
    expect(isNoise(d)).toBe(false);
    expect(isRelevant(d)).toBe(true);
  });

  it("keeps equipment authorization alone (proposed rule, subject in the action field)", () => {
    const d = doc({
      title: "Amendment of Part 2, Equipment Authorization Rules",
      action: "Proposed rule; changes to equipment authorization procedures.",
    });
    expect(fccSubstantiveSubtype(d)).toBe("keep");
    expect(isRelevant(d)).toBe(true);
  });

  it("positive control: a substantive final rule with no OMB anywhere stays kept", () => {
    const d = doc({
      title: "Protecting Against National Security Threats to the Communications Supply Chain Through the Equipment Authorization Program",
      action: "Final rule.",
      abstract: "The Commission adopts new coverage requirements for radiofrequency equipment.",
    });
    expect(isOmbApprovalNotice(d)).toBe(false);
    expect(isRelevant(d)).toBe(true);
  });
});

describe("FCC substantive rule subtype: scope and precedence", () => {
  it("does not blanket all FCC final rules: unrelated subject stays out of scope", () => {
    const d = doc({ title: "Update to Part 73 Television Station Policies", action: "Final rule." });
    expect(fccSubstantiveSubtype(d)).toBeNull();
    expect(isRelevant(d)).toBe(false); // no topic match either
  });

  it("existing spectrum/broadband keeps are unchanged (topic gate, not the helper)", () => {
    const broadband = doc({ title: "Expanding Broadband Deployment in Rural America", action: "Final rule." });
    expect(fccSubstantiveSubtype(broadband)).toBeNull();
    expect(isRelevant(broadband)).toBe(true);
    const spectrum = doc({ title: "Amendment of the 6 GHz Spectrum Rules", action: "Final rule." });
    expect(fccSubstantiveSubtype(spectrum)).toBeNull();
    expect(isRelevant(spectrum)).toBe(true);
  });

  it("FCC DA-only Notices stay out of the helper and with proceduralReason", () => {
    const d = doc({
      title: "Office of Engineering and Technology Announces the Extension of the Comment Deadline",
      type: "Notice",
      action: "Extension of comment deadline.",
      docket_ids: ["DA 26-1087"],
    });
    expect(fccSubstantiveSubtype(d)).toBeNull();
    const apiDoc: FrApiDoc = { ...d, document_number: "FCC-2026-9999" };
    expect(proceduralReason(apiDoc)).toBe("procedural:bureau-notice");
    expect(isRelevant(apiDoc)).toBe(false);
  });

  it("the OMB guard precedes the keep: same title with an effective-date action and OMB abstract is noise", () => {
    const d = doc({
      title: "Protecting Against National Security Threats to the Communications Supply Chain Through the Equipment Authorization Program",
      action: "Final rule; announcement of effective date.",
      abstract: "The Office of Management and Budget has approved the information collection requirements.",
      docket_ids: ["FCC 26-51"],
    });
    expect(fccSubstantiveSubtype(d)).toBeNull(); // the OMB guard wins inside the helper too
    expect(isOmbApprovalNotice(d)).toBe(true);
    expect(isNoise(d)).toBe(true);
    expect(isRelevant(d)).toBe(false);
  });

  it("Sunshine is still noise, even over a subject-matching keep", () => {
    const d = doc({
      title: "Sunshine Act Meeting; Equipment Authorization Program",
      action: "Open meeting.",
    });
    expect(fccSubstantiveSubtype(d)).toBe("keep");
    expect(isNoise(d)).toBe(true);
    expect(isRelevant(d)).toBe(false);
  });

  it("other agencies are out of scope", () => {
    expect(
      fccSubstantiveSubtype({
        title: "Protecting Against National Security Threats to the Communications Supply Chain Through the Equipment Authorization Program",
        type: "Rule",
        agencyLabel: "NTIA",
      }),
    ).toBeNull();
  });
});
