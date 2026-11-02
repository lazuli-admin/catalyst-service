import { describe, expect, it } from "vitest";
import { proceduralReason, type FrApiDoc } from "../src/catalysts/fr-classify.js";

describe("proceduralReason", () => {
  it("bureau notice with DA docket ID -> procedural:bureau-notice", () => {
    const doc: FrApiDoc = {
      title: "Wireless Telecommunications Bureau Establishes a New Docket...",
      type: "Notice",
      docket_ids: ["GN Docket Nos. 25-59 and 26-289", "DA 26-1087", "FR ID 373607"],
      comments_close_on: "2026-11-30",
      document_number: "test-1",
      agencyLabel: "FCC",
    };
    expect(proceduralReason(doc)).toBe("procedural:bureau-notice");
  });

  it("same doc with different title -> still procedural (title-independent)", () => {
    const doc: FrApiDoc = {
      title: "Some Other Title About Docket Numbers",
      type: "Notice",
      docket_ids: ["GN Docket Nos. 25-59 and 26-289", "DA 26-1087", "FR ID 373607"],
      comments_close_on: "2026-11-30",
      document_number: "test-2",
      agencyLabel: "FCC",
    };
    expect(proceduralReason(doc)).toBe("procedural:bureau-notice");
  });

  it("near-miss: Proposed Rule with FCC docket -> null", () => {
    const doc: FrApiDoc = {
      title: "Unleashing Unlicensed Spectrum for Direct-to-Device",
      type: "Proposed Rule",
      docket_ids: ["ET Docket No. 26-169", "FCC 26-51", "FR ID 364887"],
      document_number: "test-3",
      agencyLabel: "FCC",
    };
    expect(proceduralReason(doc)).toBeNull();
  });

  it("near-miss: Notice with FCC docket -> null", () => {
    const doc: FrApiDoc = {
      title: "Some Title",
      type: "Notice",
      docket_ids: ["FCC 26-60"],
      document_number: "test-4",
      agencyLabel: "FCC",
    };
    expect(proceduralReason(doc)).toBeNull();
  });

  it("Notice with no docket_ids -> null", () => {
    const doc: FrApiDoc = {
      title: "Some Title",
      type: "Notice",
      docket_ids: null,
      document_number: "test-5",
      agencyLabel: "FCC",
    };
    expect(proceduralReason(doc)).toBeNull();
  });

  it("Proposed Rule with FCC docket -> null", () => {
    const doc: FrApiDoc = {
      title: "Wireless Telecommunications Bureau ...",
      type: "Proposed Rule",
      docket_ids: ["DA 26-1087"],
      document_number: "test-6",
      agencyLabel: "FCC",
    };
    expect(proceduralReason(doc)).toBeNull();
  });
});