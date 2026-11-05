import { describe, expect, it } from "vitest";
import { isRelevant, type FrDoc } from "../src/topics.js";

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
});