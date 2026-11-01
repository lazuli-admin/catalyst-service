import { describe, expect, it } from "vitest";
import {
  COMPANY_UNIVERSE,
  buildUniverse,
  consentPartyTickers,
  normalizeCompanyName,
} from "../src/company-universe.js";
import { PRESET_TRADES } from "../src/presets.js";
import { isRelevant, topicTags } from "../src/topics.js";

const SEVITA_BTSG =
  "Sevita and BrightSpring; Analysis of Proposed Agreement Containing Consent Orders To Aid Public Comment";
const AUROBINDO =
  "Aurobindo and Lannett; Analysis of Proposed Agreement Containing Consent Orders To Aid Public Comment";
const NVDA_TITLE =
  "Nvidia Corporation and Example Target, Inc.; Analysis of Proposed Agreement Containing Consent Orders To Aid Public Comment";
const NEAR_MISS_UNLISTED =
  "Example Alpha and Example Beta; Analysis of Proposed Agreement Containing Consent Orders To Aid Public Comment";
const NEAR_MISS_GENERIC =
  "Circle Logistics and Strategy Partners LLC; Analysis of Proposed Agreement Containing Consent Orders To Aid Public Comment";

describe("normalizeCompanyName", () => {
  it("strips punctuation and corporate suffixes", () => {
    expect(normalizeCompanyName("Nvidia Corporation")).toBe("nvidia");
    expect(normalizeCompanyName("NVIDIA Corp.")).toBe("nvidia");
    expect(normalizeCompanyName("Example Holdings, Inc.")).toBe("example");
  });
});

describe("consentPartyTickers with injected universe", () => {
  const injected = [
    { name: "BrightSpring", ticker: "BTSG", names: ["brightspring"] },
    { name: "Aurobindo", ticker: "AUROBINDO", names: ["aurobindo"] },
  ];
  it("matches a listed party", () => {
    expect(consentPartyTickers(SEVITA_BTSG, injected)).toEqual([{ ticker: "BTSG", name: "BrightSpring" }]);
  });
  it("matches the other listed party", () => {
    expect(consentPartyTickers(AUROBINDO, injected)).toEqual([{ ticker: "AUROBINDO", name: "Aurobindo" }]);
  });
});

describe("consentPartyTickers with the real COMPANY_UNIVERSE", () => {
  it("keeps Nvidia consent orders", () => {
    expect(consentPartyTickers(NVDA_TITLE)).toEqual([{ ticker: "NVDA", name: "Nvidia" }]);
    expect(isRelevant({ title: NVDA_TITLE })).toBe(true);
    expect(topicTags({ title: NVDA_TITLE }).affectedTickers).toContain("NVDA");
  });
  it("drops unlisted near-miss parties", () => {
    expect(consentPartyTickers(NEAR_MISS_UNLISTED)).toEqual([]);
    expect(isRelevant({ title: NEAR_MISS_UNLISTED })).toBe(false);
  });
  it("never matches substrings of company names", () => {
    expect(consentPartyTickers(NEAR_MISS_GENERIC)).toEqual([]);
  });
  it("ignores titles without consent/merger language", () => {
    expect(consentPartyTickers("Oracle Example Notice")).toEqual([]);
  });
});

describe("COMPANY_UNIVERSE contents", () => {
  it("excludes BrightSpring and Aurobindo (not in the preset universe today)", () => {
    expect(COMPANY_UNIVERSE.some((c) => /brightspring/i.test(c.name))).toBe(false);
    expect(COMPANY_UNIVERSE.some((c) => /aurobindo/i.test(c.name))).toBe(false);
    expect(consentPartyTickers(SEVITA_BTSG)).toEqual([]);
    expect(consentPartyTickers(AUROBINDO)).toEqual([]);
  });
  it("excludes government agencies and bodies", () => {
    const banned = ["Federal Reserve", "SEC", "CFTC", "Congress"];
    for (const name of banned) {
      expect(COMPANY_UNIVERSE.some((c) => c.name === name)).toBe(false);
    }
  });
  it("buildUniverse returns the same universe by default", () => {
    expect(buildUniverse()).toEqual(COMPANY_UNIVERSE);
  });
  it("resolves Amazon to AMZN, not AWS", () => {
    const amzn = COMPANY_UNIVERSE.find((c) => c.name === "Amazon");
    expect(amzn?.ticker).toBe("AMZN");
    expect(amzn?.names).not.toContain("amzn");
    expect(consentPartyTickers("Amazon and Example Co.; Analysis of Proposed Agreement Containing Consent Orders To Aid Public Comment")).toEqual([{ ticker: "AMZN", name: "Amazon" }]);
  });
  it("matches AMD via Advanced Micro Devices", () => {
    const amd = COMPANY_UNIVERSE.find((c) => c.name === "AMD");
    expect(amd?.ticker).toBe("AMD");
    expect(amd?.names).toContain("advanced micro devices");
    expect(consentPartyTickers("Advanced Micro Devices and Example Co.; Analysis of Proposed Agreement Containing Consent Orders To Aid Public Comment")).toEqual([{ ticker: "AMD", name: "AMD" }]);
  });
  it("maps Circle to CRCL iff CRCL is in PRESET_TRADES tickers", () => {
    const crclListed = PRESET_TRADES.some((t) => t.tickers.includes("CRCL"));
    const circle = COMPANY_UNIVERSE.find((c) => c.name === "Circle");
    if (crclListed) {
      expect(circle?.ticker).toBe("CRCL");
    } else {
      expect(circle).toBeUndefined();
    }
  });
});
