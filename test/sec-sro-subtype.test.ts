import { describe, expect, it } from "vitest";
import {
  isNoise,
  isRelevant,
  secSroSubtype,
  SEC_SRO_KEEP_RE,
  SEC_SRO_NOISE_RE,
  SEC_SRO_TIMING_RE,
  type FrDoc,
} from "../src/topics.js";

const doc = (title: string, opts: Partial<FrDoc> = {}): FrDoc => ({
  title,
  type: "Notice",
  agencyLabel: "SEC",
  ...opts,
});

describe("SEC SRO subtype: scope", () => {
  it("applies only to SEC filings of type Notice/Rule/Proposed Rule (or absent type)", () => {
    for (const type of ["Notice", "Rule", "Proposed Rule", undefined]) {
      expect(
        secSroSubtype(doc("Self-Regulatory Organizations; NYSE; Proposed Rule Change To Establish New Listing Standards", { type })),
      ).toBe("keep");
    }
    // other types and other agencies stay out of scope
    expect(secSroSubtype(doc("Self-Regulatory Organizations; NYSE; x", { type: "Presidential Document" }))).toBeNull();
    expect(secSroSubtype(doc("Self-Regulatory Organizations; NYSE; x", { agencyLabel: "CFTC" }))).toBeNull();
    expect(secSroSubtype(doc("SEC; Notice of Filing of Proposed Rule Change", { agencyLabel: undefined }))).toBeNull();
  });

  it("requires the Self-Regulatory Organizations title prefix", () => {
    expect(
      secSroSubtype(doc("Notice of Filing of Proposed Rule Change To Establish New Listing Standards")),
    ).toBeNull();
  });
});

describe("SEC SRO subtype: noise (drop first)", () => {
  const noise: Array<[string, string | undefined]> = [
    ["Self-Regulatory Organizations; NYSE; Notice of Filing of Proposed Rule Change To Establish Fees for Options Trading", undefined],
    ["Self-Regulatory Organizations; Cboe Exchange; Proposed Rule Change to Update the Fee Schedule for Options", undefined],
    ["Self-Regulatory Organizations; Nasdaq; Notice of Filing of a Proposed Rule Change Relating to CAT NMS Plan Fees", undefined],
    ["Self-Regulatory Organizations; NYSE; Notice of Designation of a Longer Period for Commission Action on a Proposed Rule Change", undefined],
    ["Self-Regulatory Organizations; NYSE; Proposed Rule Change Regarding LULD Price Bands", undefined],
    ["Self-Regulatory Organizations; Nasdaq; Proposed Rule Change to Modify the Circuit Breaker Mechanism", undefined],
    ["Self-Regulatory Organizations; IEX; Notice of Filing of Proposed Rule Change Concerning Clearly Erroneous Executions", undefined],
    ["Self-Regulatory Organizations; NYSE; Notice of Filing of a Proposed Rule Change; Technical Amendments", undefined],
    ["Self-Regulatory Organizations; Nasdaq; Proposed Rule Change Making Conforming Changes to Rules", undefined],
  ];
  for (const [title, action] of noise) {
    it(`noise: ${title}`, () => {
      const d = doc(title, { action });
      expect(secSroSubtype(d)).toBe("noise");
      expect(isNoise(d)).toBe(true);
      expect(isRelevant(d)).toBe(false);
    });
  }

  it("routine fee filings mentioning options are still noise", () => {
    const d = doc(
      "Self-Regulatory Organizations; NYSE; Notice of Filing of Proposed Rule Change To Establish Fees for Options on Indexes",
      { action: "Notice of filing of a proposed rule change to establish fees for options" },
    );
    expect(secSroSubtype(d)).toBe("noise");
    expect(isRelevant(d)).toBe(false);
  });

  it("spelled-out Consolidated Audit Trail is noise (not just the CAT abbreviation)", () => {
    const d = doc("Self-Regulatory Organizations; FINRA; Notice of Filing of a Proposed Rule Change Relating to Consolidated Audit Trail NMS Plan Data");
    expect(secSroSubtype(d)).toBe("noise");
    expect(isRelevant(d)).toBe(false);
  });

  it("correction documents drop before the subtype keep", () => {
    const d = doc("Self-Regulatory Organizations; NYSE; Proposed Rule Change To Establish New Listing Standards", {
      documentNumber: "C1-2026-01234",
    });
    expect(secSroSubtype(d)).toBe("keep"); // helper is scope-only; the correction gate is outside it
    expect(isNoise(d)).toBe(true);
    expect(isRelevant(d)).toBe(false);
  });

  it("the OMB guard wins before the subtype keep (action-based effective-date + OMB abstract)", () => {
    const d = doc("Self-Regulatory Organizations; NYSE; Proposed Rule Change To Establish New Listing Standards", {
      action: "Final rule; announcement of effective date.",
      abstract: "The Office of Management and Budget has approved the information collection requirements.",
    });
    expect(secSroSubtype(d)).toBe("keep");
    expect(isNoise(d)).toBe(true);
    expect(isRelevant(d)).toBe(false);
  });

  it("keep regex does not match routine trading-hours/plumbing, removals, or bare references", () => {
    expect(SEC_SRO_KEEP_RE.test("to permit trading during extended trading hours")).toBe(false);
    expect(SEC_SRO_KEEP_RE.test("to remove listing standards")).toBe(false);
    expect(SEC_SRO_KEEP_RE.test("to update a cross-reference to listing standards")).toBe(false);
    // ...but a removal paired with establishing new standards still keeps
    expect(SEC_SRO_KEEP_RE.test("to remove existing listing rules and establish new listing standards")).toBe(true);
  });

  it("subtype stays out of scope for plumbing/removal titles (old behavior applies)", () => {
    expect(secSroSubtype(doc("Self-Regulatory Organizations; NYSE; Proposed Rule Change to Permit Trading During Extended Trading Hours"))).toBeNull();
    expect(secSroSubtype(doc("Self-Regulatory Organizations; NYSE; Notice of Withdrawal of a Proposed Rule Change To Remove Listing Standards"))).toBeNull();
  });
});

describe("SEC SRO subtype: keep", () => {
  const keep: Array<[string, string | undefined]> = [
    // title alone
    ["Self-Regulatory Organizations; NYSE; Proposed Rule Change To Establish New Listing Standards", undefined],
    ["Self-Regulatory Organizations; NYSE; Notice of Filing of a Proposed Rule Change To Remove Existing Listing Rules and Establish New Listing Standards", undefined],
    ["Self-Regulatory Organizations; NYSE Arca; Notice of Filing of Proposed Rule Change To List and Trade Shares of the XYZ ETP", undefined],
    // action alone
    ["Self-Regulatory Organizations; NYSE; Notice of Filing of Proposed Rule Change", "Notice of filing of a proposed rule change to permit the listing and trading of binary options"],
    ["Self-Regulatory Organizations; Nasdaq; Notice of Filing of Proposed Rule Change", "Proposed rule change to permit listing and trading of options on an ETP"],
    // exchange registration
    ["Self-Regulatory Organizations; Notice of Filing of Application for Registration as a National Securities Exchange", undefined],
  ];
  for (const [title, action] of keep) {
    it(`keep: ${title}`, () => {
      const d = doc(title, { action });
      expect(secSroSubtype(d)).toBe("keep");
      expect(isNoise(d)).toBe(false);
      expect(isRelevant(d)).toBe(true);
    });
  }

  it("timing designation is rescued when the underlying subject is a substantive listing/product filing", () => {
    const d = doc(
      "Self-Regulatory Organizations; NYSE; Notice of Designation of a Longer Period for Commission Action on a Proposed Rule Change To Establish New Listing Standards",
      { action: "Notice of designation of a longer period" },
    );
    expect(secSroSubtype(d)).toBe("keep");
    expect(isRelevant(d)).toBe(true);
  });

  it("existing crypto-topic SRO keeps remain", () => {
    expect(
      isRelevant(
        doc("Self-Regulatory Organizations; NYSE Arca; Notice of Filing of Proposed Rule Change To List and Trade Shares of the Bitwise Bitcoin ETF"),
      ),
    ).toBe(true);
  });
});

describe("SEC SRO subtype: cross-agency control (no global broadening)", () => {
  it("non-SEC timing+listing titles are not rescued by the helper", () => {
    const d = doc(
      "Self-Regulatory Organizations; NYSE; Notice of Designation of a Longer Period for Commission Action on a Proposed Rule Change To Establish New Listing Standards",
      { agencyLabel: "CFTC" },
    );
    expect(secSroSubtype(d)).toBeNull();
    // old global noise list still governs (timing designation is noise)
    expect(isRelevant(d)).toBe(false);
  });

  it("non-SEC circuit-breaker/title match falls back to old behavior", () => {
    const d = doc("Self-Regulatory Organizations; NYSE; Proposed Rule Change Regarding LULD Price Bands", {
      agencyLabel: "Department of Commerce",
    });
    expect(secSroSubtype(d)).toBeNull();
  });
});

describe("SEC SRO subtype: regex sanity", () => {
  it("timing regex matches the two procedural phrases", () => {
    expect(SEC_SRO_TIMING_RE.test("designation of a longer period for commission action")).toBe(true);
    expect(SEC_SRO_TIMING_RE.test("extension of the time for filing")).toBe(true);
    expect(SEC_SRO_TIMING_RE.test("to permit the listing and trading of shares")).toBe(false);
  });

  it("noise regex catches fees/CAT/LULD, not listing standards", () => {
    expect(SEC_SRO_NOISE_RE.test("to establish fees for options")).toBe(true);
    expect(SEC_SRO_NOISE_RE.test("CAT NMS Plan")).toBe(true);
    expect(SEC_SRO_NOISE_RE.test("Consolidated Audit Trail NMS Plan")).toBe(true);
    expect(SEC_SRO_NOISE_RE.test("to establish new listing standards")).toBe(false);
  });

  it("keep regex catches listing/product/registration subjects", () => {
    expect(SEC_SRO_KEEP_RE.test("to establish new listing standards")).toBe(true);
    expect(SEC_SRO_KEEP_RE.test("to permit the listing and trading of binary options")).toBe(true);
    expect(SEC_SRO_KEEP_RE.test("registration as a national securities exchange")).toBe(true);
    expect(SEC_SRO_KEEP_RE.test("to update the fee schedule")).toBe(false);
  });});
