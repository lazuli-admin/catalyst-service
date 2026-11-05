import { describe, expect, it } from "vitest";
import { isAdministrativePresidential, isOmbApprovalNotice, isRelevant } from "../src/topics.js";

describe("administrative OMB/PRA approval notices", () => {
  it("drops effective-date announcements whose abstract mentions OMB/PRA", () => {
    const doc = {
      type: "Rule",
      title: "Promoting Telehealth for Low-Income Consumers; Announcement of Effective Date",
      abstract:
        "This document announces the effective date. The Office of Management and Budget (OMB) approved the information collection requirements under the Paperwork Reduction Act.",
    };
    expect(isOmbApprovalNotice(doc)).toBe(true);
    expect(isRelevant(doc)).toBe(false);
  });

  it("keeps effective-date announcements without OMB/PRA wording (control)", () => {
    const doc = {
      type: "Rule",
      title: "Cross-Margining of Treasury Futures; Announcement of Effective Date",
      abstract: "This document announces the effective date of the final rule on cross-margining arrangements.",
    };
    expect(isOmbApprovalNotice(doc)).toBe(false);
    expect(isRelevant(doc)).toBe(true);
  });

  it("drops titles announcing OMB approval directly", () => {
    expect(isOmbApprovalNotice({ title: "OMB Approval; Information Collection for Survey of Participants" })).toBe(true);
  });
});

describe("administrative presidential negatives", () => {
  it("drops advisory-committee continuances and pay adjustments", () => {
    const dropped = [
      "Continuance of Certain Federal Advisory Committees",
      "Continuing the President's Council of Advisors on Science and Technology",
      "Adjustments of Certain Rates of Pay",
    ];
    for (const title of dropped) {
      const doc = { title, type: "Presidential Document" };
      expect(isAdministrativePresidential(doc)).toBe(true);
      expect(isRelevant(doc)).toBe(false);
    }
  });

  it("continuation titles with an operative verb are kept", () => {
    const kept = [
      "Continuing the Suspension of Duties and Modifying the Board of Trade Arrangements",
      "Continuing the Imposition of Tariffs Recommended by the Trade Board",
    ];
    for (const title of kept) {
      const doc = { title, type: "Presidential Document" };
      expect(isAdministrativePresidential(doc)).toBe(false);
      expect(isRelevant(doc)).toBe(true);
    }
  });

  it("keeps substantive presidential documents (control)", () => {
    const kept = [
      "Adjusting Imports of Copper Into the United States",
      "Establishing the President's Military Spouse Commission",
    ];
    for (const title of kept) {
      const doc = { title, type: "Presidential Document" };
      expect(isAdministrativePresidential(doc)).toBe(false);
      expect(isRelevant(doc)).toBe(true);
    }
  });
});
