import { describe, expect, it } from "vitest";
import { isRelevant, topicTags, type FrDoc } from "../src/topics.js";

const doc = (title: string, abstract?: string): FrDoc => ({ title, abstract });

describe("topic near-misses", () => {
  it("USMCA / trade agreements: keeps USMCA actions and FTA negotiating objectives, drops routine FTA rules-of-origin notices", () => {
    const keeps = [
      "Request for Comments Concerning the Operation of the United States-Mexico-Canada Agreement With Respect To Trade in Automotive Goods",
      "Joint Review of the U.S.-Mexico-Canada Agreement",
      "Negotiating Objectives for a United States-Kenya Free Trade Agreement",
    ];
    for (const title of keeps) {
      expect(isRelevant(doc(title)), title).toBe(true);
      expect(topicTags(doc(title)).topics, title).toContain("usmca-trade-agreements");
    }
    const drop = "United States-Bahrain Free Trade Agreement Rules of Origin";
    expect(isRelevant(doc(drop))).toBe(false);
  });

  it("submarine cables: keeps subsea/undersea cable security, drops cable television", () => {
    const keeps = ["Undersea Cable Security Review", "Subsea Cables: Foreign Adversary Ownership"];
    for (const title of keeps) {
      expect(isRelevant(doc(title)), title).toBe(true);
      expect(topicTags(doc(title)).topics, title).toContain("submarine-cables");
    }
    expect(isRelevant(doc("Cable Television Rate Regulation"))).toBe(false);
  });

  it("swaps: keeps CEA clearing requirements, drops debt-for-nature swaps", () => {
    const keep = "Clearing Requirement Determination Under Section 2(h) of the Commodity Exchange Act for Interest Rate Swaps";
    expect(isRelevant(doc(keep))).toBe(true);
    expect(topicTags(doc(keep)).topics).toContain("swaps-margining");
    const drop = "Debt-for-Nature Swaps Program Notice";
    expect(isRelevant(doc(drop))).toBe(false);
    expect(topicTags(doc(drop)).topics).not.toContain("swaps-margining");
  });

  it("trade remedy: keeps AD/CVD determinations, drops administrative review initiations", () => {
    const keeps = [
      { title: "Fresh Mushrooms From Canada: Initiation of Less-Than-Fair-Value Investigation" },
      { title: "Certain Steel Nails From Vietnam: Initiation of Countervailing Duty Investigation" },
      { title: "Paper Plates From Thailand: Final Negative Determination of Sales at Less Than Fair Value" },
      {
        title: "Certain Widgets From Korea: Final Determination",
        abstract: "Commerce determines that widgets are not being, or not likely to be, sold at less than fair value.",
      },
    ];
    for (const k of keeps) {
      expect(isRelevant(doc(k.title, k.abstract)), k.title).toBe(true);
      expect(topicTags(doc(k.title, k.abstract)).topics, k.title).toContain("trade-remedy");
    }
    expect(isRelevant(doc("Initiation of Antidumping and Countervailing Duty Administrative Reviews"))).toBe(false);
  });

  it("foreign issuer disclosure: keeps HFCAA and foreign private issuer rules, drops foreign trade zone reports", () => {
    expect(isRelevant(doc("Holding Foreign Insiders Accountable Act Disclosure"))).toBe(true);
    const fpi = "Amendments to the Definition of Foreign Private Issuer";
    expect(isRelevant(doc(fpi))).toBe(true);
    expect(topicTags(doc(fpi)).topics).toContain("foreign-issuer-disclosure");
    expect(isRelevant(doc("Foreign Trade Zone Board Annual Report"))).toBe(false);
  });
});
