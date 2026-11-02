import { describe, expect, it } from "vitest";
import {
  buildSecUniverse,
  buildUniverse,
  consentPartyTickers,
  normalizeCompanyName,
  SEC_COMPANIES,
} from "../src/company-universe.js";

const SEVITA_BTSG =
  "Sevita and BrightSpring; Analysis of Proposed Agreement Containing Consent Orders To Aid Public Comment";
const AUROBINDO_LANNETT =
  "Aurobindo and Lannett; Analysis of Proposed Agreement Containing Consent Orders To Aid Public Comment";

describe("SEC_COMPANIES", () => {
  it("loads companies from the snapshot", () => {
    expect(Array.isArray(SEC_COMPANIES)).toBe(true);
    expect(SEC_COMPANIES.length).toBeGreaterThan(0);
    expect(SEC_COMPANIES[0]).toHaveProperty("cik");
    expect(SEC_COMPANIES[0]).toHaveProperty("ticker");
    expect(SEC_COMPANIES[0]).toHaveProperty("title");
  });
});

describe("buildSecUniverse", () => {
  it("creates universe companies from SEC data", () => {
    const universe = buildSecUniverse(SEC_COMPANIES);
    expect(universe.length).toBeGreaterThan(0);
    expect(universe[0]).toHaveProperty("name");
    expect(universe[0]).toHaveProperty("ticker");
    expect(universe[0]).toHaveProperty("names");
  });

  it("skips rows with empty normalized names", () => {
    // Create a mock SEC entry with an invalid title that produces empty normalized name
    const mockCompanies = [
      { cik: 1, ticker: "TEST", title: "Co" }, // This should produce empty normalized name
      { cik: 2, ticker: "AAPL", title: "Apple Inc." }, 
    ];
    const universe = buildSecUniverse(mockCompanies);
    expect(universe.some(c => c.ticker === "TEST")).toBe(false);
    expect(universe.some(c => c.ticker === "AAPL")).toBe(true);
  });

  it("maps BlackRock to BLK (not IBIT)", () => {
    const universe = buildSecUniverse(SEC_COMPANIES);
    const blackrock = universe.find(c => normalizeCompanyName(c.name) === "blackrock");
    expect(blackrock).toBeDefined();
    expect(blackrock?.ticker).toBe("BLK");
  });

  it("BlackRock maps to BLK via buildUniverse", () => {
    const universe = buildUniverse();
    const blackrock = universe.find(c => c.name === "BlackRock");
    expect(blackrock).toBeDefined();
    expect(blackrock?.ticker).toBe("BLK");
  });
});

describe("consentPartyTickers with SEC data", () => {
  it("matches companies from SEC universe when in the title", () => {
    // Test with a company that exists in the SEC data but not in presets
    const result = consentPartyTickers(SEVITA_BTSG);
    expect(result.map(m => m.ticker)).toContainEqual("BTSG");
  });

  it("returns empty array for companies not in SEC universe", () => {
    // Aurobindo and Lannett are not in the snapshot, so they shouldn't match
    const result = consentPartyTickers(AUROBINDO_LANNETT);
    expect(result).toEqual([]);
  });

  it("handles near-misses correctly", () => {
    // These should not match due to lack of corporate suffixes or explicit consent language
    expect(consentPartyTickers("Target Date Retirement Funds Acquisition Notice")).toEqual([]);
    expect(consentPartyTickers("Apple Orchards and Orange Groves acquisition")).toEqual([]);
    expect(consentPartyTickers("Visa Waiver Program acquisition")).toEqual([]);
    expect(consentPartyTickers("Gap Analysis acquisition program")).toEqual([]);
    
    // These should match because they have corporate suffixes or explicit consent language
    expect(consentPartyTickers("Apple Inc. and Widget Co.; Analysis of Proposed Consent Order").map(m => m.ticker)).toEqual(["AAPL"]);
    // ambiguous in SEC list: TARGET CORP (TGT) and Target Group Inc. (CBDY)
    expect(consentPartyTickers("Target Corporation and Foo Holdings; acquisition").map(m => m.ticker)).toEqual([]);
    expect(consentPartyTickers("Visa and Foo; Analysis of Proposed Agreement Containing Consent Orders").map(m => m.ticker)).toEqual(["V"]);
  });

  it("short/common bare names need a legal suffix or explicit consent/merger title", () => {
    expect(consentPartyTickers("Apple and Orange Groves; acquisition of orchards").map(m => m.ticker)).not.toContain("AAPL");
    expect(consentPartyTickers("Target and Foo Widgets; acquisition notice").map(m => m.ticker)).not.toContain("TGT");
    expect(consentPartyTickers("Target and Foo Widgets; acquisition notice").map(m => m.ticker)).not.toContain("CBDY");
    expect(consentPartyTickers("Visa and Foo Widgets; acquisition notice").map(m => m.ticker)).not.toContain("V");
    expect(consentPartyTickers("Gap and Foo Widgets; acquisition notice").map(m => m.ticker)).not.toContain("GAP");

    expect(consentPartyTickers("Visa and Foo Widgets; Analysis of Proposed Agreement Containing Consent Orders").map(m => m.ticker)).toContain("V");
    expect(consentPartyTickers("Gap Inc. and Foo Widgets; acquisition notice").map(m => m.ticker)).toContain("GAP");
  });

  it("matches an injected universe with a unique normalized name", () => {
    const u = buildSecUniverse([{ cik: 1, ticker: "TGT", title: "TARGET CORP" }]);
    const result = consentPartyTickers("Target Corporation and Foo Holdings; acquisition", u);
    expect(result.map(m => m.ticker)).toEqual(["TGT"]);
  });

  it("does not match abstract tokens", () => {
    // Party head ("Widget Co. and Gizmo LLC") has no company; Apple only appears in the text after ';'
    expect(consentPartyTickers("Widget Co. and Gizmo LLC; Analysis of Proposed Consent Order involving Apple Inc. assets").map(m => m.ticker)).toEqual([]);
  });

  it("matches unique prefix against SEC-derived companies", () => {
    // Injected universe: "zenithco" matches only one company
    const u = buildSecUniverse([{ cik: 1, ticker: "ZWID", title: "Zenithco Widgets Inc" }]);
    const result = consentPartyTickers("Zenithco and Foo; Analysis of Proposed Consent Order", u);
    expect(result.map(m => m.ticker)).toEqual(["ZWID"]);
  });

  it("does not match non-unique prefix against SEC-derived companies", () => {
    // Injected universe: two companies share the prefix "zenithco"
    const u = buildSecUniverse([
      { cik: 1, ticker: "ZWID", title: "Zenithco Widgets Inc" },
      { cik: 2, ticker: "ZGAD", title: "Zenithco Gadgets Inc" },
    ]);
    const result = consentPartyTickers("Zenithco and Foo; Analysis of Proposed Consent Order", u);
    expect(result).toEqual([]);
  });
});