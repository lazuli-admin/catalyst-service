import { describe, expect, it } from "vitest";
import { SECTORS, sectorOf } from "../src/catalysts/sectors.js";

describe("SECTORS", () => {
  it("is a flat map keyed by ticker", () => {
    expect(SECTORS.NVDA).toBe("semis");
    expect(SECTORS.MSFT).toBe("hyperscalers/cloud");
    expect(SECTORS.AAPL).toBe("consumer tech");
    expect(SECTORS.APP).toBe("software");
    expect(SECTORS.HOOD).toBe("fintech");
  });
});

describe("sectorOf", () => {
  it("returns the sector and up to 5 peers, excluding itself, in map order", () => {
    const { sector, peers } = sectorOf("NVDA");
    expect(sector).toBe("semis");
    expect(peers).toEqual(["AMD", "AVGO", "MRVL", "LITE", "AMAT"]);
    expect(peers).toHaveLength(5);
    expect(peers).not.toContain("NVDA");

    const software = sectorOf("APP");
    expect(software.sector).toBe("software");
    expect(software.peers).toEqual(["RDDT", "HUBS", "NOW", "TWLO", "DOCN"]);
    expect(software.peers).toHaveLength(5);

    const fintech = sectorOf("HOOD");
    expect(fintech.sector).toBe("fintech");
    expect(fintech.peers).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(sectorOf("nvda").sector).toBe("semis");
    expect(sectorOf("nvda").peers).toEqual(sectorOf("NVDA").peers);
  });

  it("returns Unclassified for unknown tickers", () => {
    expect(sectorOf("UNKNOWN")).toEqual({ sector: "Unclassified", peers: [] });
  });
});
