import { describe, expect, test } from "vitest";
import { SEC_ADMIN_LOW_IMPACT_RE, isNoise, isRelevant, type FrDoc } from "../src/topics.js";

const doc = (title: string, type = "Rule"): FrDoc => ({ title, type, agencyLabel: "SEC" });

describe("SEC low-impact administrative rules are not relevant", () => {
  const noise = [
    "Adoption of Updated EDGAR Filer Manual",
    "Electronic Submission of Certain Materials Under the Securities Exchange Act of 1934; Amendments Regarding the FOCUS Report",
    "Inline XBRL Filing of Tagged Data",
    "Technical Amendments to Rules of Practice",
  ];
  for (const title of noise) {
    test(`not relevant: ${title}`, () => {
      expect(SEC_ADMIN_LOW_IMPACT_RE.test(title)).toBe(true);
      expect(isRelevant(doc(title))).toBe(false);
    });
  }

  test("technical amendments riding along with substantive changes are kept", () => {
    for (const title of [
      "Export Administration Regulations: Expansion of Controls on Advanced Computing Items; Technical Amendments",
      "Entity List Additions; Revisions and Technical Amendments",
    ]) {
      expect(SEC_ADMIN_LOW_IMPACT_RE.test(title)).toBe(false);
    }
  });

  test("technical amendments as the whole substance are noise", () => {
    for (const title of [
      "Technical Amendments to Rules of Practice",
      "Regulation S-T: Technical Amendments",
      "Form X-17A-5; Technical Amendments",
    ]) {
      expect(SEC_ADMIN_LOW_IMPACT_RE.test(title)).toBe(true);
    }
  });

  test("paired technical amendments are kept", () => {
    expect(
      SEC_ADMIN_LOW_IMPACT_RE.test("Amendments to Regulation SHO and Technical Amendments to Rules of Practice"),
    ).toBe(false);
  });

  test("substantive SEC rules never match", () => {
    for (const title of [
      "Treasury Clearing",
      "Standards for Covered Clearing Agencies",
      "Regulation NMS",
      "Order Competition Rule",
      "Minimum Pricing Increments",
      "Security-Based Swap Disclosure",
    ]) {
      expect(SEC_ADMIN_LOW_IMPACT_RE.test(title)).toBe(false);
    }
  });

  test("positive controls stay relevant", () => {
    expect(
      isRelevant(
        doc(
          "Standards for Covered Clearing Agencies for U.S. Treasury Securities and Application of the Broker-Dealer Customer Protection Rule With Respect to U.S. Treasury Securities",
        ),
      ),
    ).toBe(true);
    expect(isRelevant(doc("Cross-Margining of Treasury Futures and Cash Treasury Securities"))).toBe(true);
  });
});

describe("SEC_ADMIN_LOW_IMPACT_RE is scoped to SEC", () => {
  test("SEC electronic-delivery paperwork is noise", () => {
    expect(isNoise({ title: "Electronic Delivery of Certain Filings", type: "Rule", agencyLabel: "SEC" })).toBe(true);
  });

  test("the same pattern does not fire for other agencies", () => {
    expect(isNoise({ title: "Electronic Filing of Customs Entries", type: "Rule", agencyLabel: "CBP" })).toBe(false);
    expect(isNoise({ title: "Electronic Delivery of Certain Filings", type: "Rule", agencyLabel: "FCC" })).toBe(false);
  });
});