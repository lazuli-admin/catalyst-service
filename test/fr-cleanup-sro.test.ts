import { describe, expect, it } from "vitest";
import { isRelevant, type FrDoc, SRO_NEW_VENUE_RE, isExchangeRegistrationAck } from "../src/topics.js";

const doc = (title: string, abstract?: string): FrDoc => ({ title, abstract });

describe("SRO filing subtype", () => {
  it("keeps SRO filings about exchange products/listings", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; NYSE Arca, Inc.; Notice of Filing of Proposed Rule Change To Amend Listing Standards for Commodity-Based Trust Shares",
        ),
      ),
    ).toBe(true);
  });

  it("keeps SRO filings about options on a bitcoin ETF", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; Nasdaq Stock Market LLC; Notice of Filing of a Proposed Rule Change To List and Trade Options on the Nasdaq Bitcoin ETF",
          "The Exchange proposes to list and trade options on the trust that holds bitcoin.",
        ),
      ),
    ).toBe(true);
  });

  it("drops SRO fee-schedule filings", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; Nasdaq Stock Market LLC; Notice of Filing and Immediate Effectiveness of Proposed Rule Change To Amend the Exchange's Fee Schedule",
        ),
      ),
    ).toBe(false);
  });

  it("drops SRO filings with no high-weight topic", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; Cboe BZX Exchange, Inc.; Notice of Filing and Immediate Effectiveness of a Proposed Rule Change To Amend Rule 11.17 (Clearly Erroneous Executions)",
        ),
      ),
    ).toBe(false);
  });

  it("leaves non-SRO docs unchanged", () => {
    expect(isRelevant(doc("SEC Adopts Rules for Security-Based Swap Dealers"))).toBe(true);
  });

  it("keeps SRO filings proposing to permit listing and trading of new products (binary options)", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; Cboe Exchange, Inc.; Notice of Filing of a Proposed Rule Change To Permit the Listing and Trading of Binary Options Overlying Key Performance Indicators",
        ),
      ),
    ).toBe(true);
  });

  it("keeps SRO filings adopting generic listing standards", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; NYSE Arca, Inc.; Order Approving a Proposed Rule Change To Adopt Generic Listing Standards for Commodity-Based Trust Shares",
        ),
      ),
    ).toBe(true);
  });

  it("keeps acknowledgements of exchange registration", () => {
    expect(
      isRelevant(
        doc(
          "Acknowledgement of Receipt of Notice of Registration as a National Securities Exchange Under Section 6 of the Securities Exchange Act of 1934",
        ),
      ),
    ).toBe(true);
  });

  it("drops SRO CAT-fee filings", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; Financial Industry Regulatory Authority, Inc.; Notice of Filing of a Proposed Rule Change To Establish Fees for Consolidated Audit Trail Funding",
        ),
      ),
    ).toBe(false);
  });

  it("drops SRO market-data fee filings on extended review", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; Nasdaq Stock Market LLC; Notice of Designation of a Longer Period for Commission Action on a Proposed Rule Change To Amend Fees for Market Data",
        ),
      ),
    ).toBe(false);
  });

  it("drops SRO fee-schedule filings (PHLX)", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; Nasdaq PHLX LLC; Notice of Filing and Immediate Effectiveness of a Proposed Rule Change To Amend the Exchange's Fee Schedule",
        ),
      ),
    ).toBe(false);
  });

  it("drops SRO clearly-erroneous-execution rule amendments", () => {
    expect(
      isRelevant(
        doc(
          "Self-Regulatory Organizations; NYSE American LLC; Notice of Filing and Immediate Effectiveness of a Proposed Rule Change To Amend Rule 7.10 Regarding Clearly Erroneous Executions",
        ),
      ),
    ).toBe(false);
  });

  it("SRO_NEW_VENUE_RE correctly rejects Form 1-A", () => {
    expect(SRO_NEW_VENUE_RE.test("Form 1-A offering statement")).toBe(false);
  });

  it("SRO_NEW_VENUE_RE correctly accepts Form 1 application", () => {
    expect(SRO_NEW_VENUE_RE.test("Form 1 application")).toBe(true);
  });

  it("isExchangeRegistrationAck accepts both spellings", () => {
    expect(isExchangeRegistrationAck(doc("Acknowledgment of Receipt of Notice of Registration as a National Securities Exchange"))).toBe(true);
  });
});