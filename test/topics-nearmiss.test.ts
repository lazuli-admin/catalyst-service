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

  it("submarine cables: keeps subsea/undersea cable security, drops cable television and marine mammal incidental takes", () => {
    const keeps = [
      "Undersea Cable Security Review",
      "Subsea Cables: Foreign Adversary Ownership",
      "Undersea Fiber Optic Cable Licenses",
      "Subsea Telecommunications Cable Security",
      "Review of Submarine Cable Landing License Rules and Procedures",
    ];
    for (const title of keeps) {
      expect(isRelevant(doc(title)), title).toBe(true);
      expect(topicTags(doc(title)).topics, title).toContain("submarine-cables");
    }
    expect(isRelevant(doc("Cable Television Rate Regulation"))).toBe(false);
    const drops = [
      "Taking and Importing Marine Mammals; Taking Marine Mammals Incidental to Cable Landing Construction",
      "Incidental Take Authorization: Marine Mammal Harassment During Cable Landing Construction",
    ];
    for (const title of drops) {
      expect(isRelevant(doc(title)), title).toBe(false);
      expect(topicTags(doc(title)).topics, title).not.toContain("submarine-cables");
    }
  });

  it("swaps: keeps CEA clearing requirements and margining, drops data repositories, fund-exemptive swaps, and currency swap lines", () => {
    const keeps = [
      "Further Definition of 'Swap'",
      "Security-Based Swap Execution Facilities",
      "Clearing Requirement Determination Under Section 2(h) of the Commodity Exchange Act for Interest Rate Swaps",
      "Portfolio Margining of Uncleared Swaps",
      "Cross-Margining of Futures and Swaps",
    ];
    for (const title of keeps) {
      expect(isRelevant(doc(title)), title).toBe(true);
      expect(topicTags(doc(title)).topics, title).toContain("swaps-margining");
    }
    const drops = [
      "Debt-for-Nature Swaps Program Notice",
      "ICE Trade Vault, LLC: Notice of Application for Registration as a Swap Data Repository",
      "Example Funds Trust, et al.; Notice of Application to Permit Funds To Enter Into Swaps With Affiliated Funds",
      "Federal Reserve Currency Swap Lines With Foreign Central Banks",
    ];
    for (const title of drops) {
      expect(isRelevant(doc(title)), title).toBe(false);
      expect(topicTags(doc(title)).topics, title).not.toContain("swaps-margining");
    }
  });

  it("trade remedy: keeps AD/CVD determinations, drops administrative review initiations", () => {
    const keeps = [
      { title: "Fresh Mushrooms From Canada: Initiation of Less-Than-Fair-Value Investigation" },
      { title: "Certain Steel Nails From Vietnam: Initiation of Countervailing Duty Investigation" },
      { title: "Paper Plates From Thailand: Final Negative Determination of Sales at Less Than Fair Value" },
      { title: "Certain Steel Wire From Mexico: Final Affirmative Determination of Sales at Less Than Fair Value" },
      { title: "Certain Paper Plates From Thailand: Final Determination of Sales at Not Less Than Fair Value" },
      { title: "Brake Drums From Turkey: Preliminary Negative Determination of Sales at Less Than Fair Value" },
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
