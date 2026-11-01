// Ticker -> sector mapping.
export const SECTORS: Record<string, string> = {
  NVDA: "semis",
  AMD: "semis",
  AVGO: "semis",
  MRVL: "semis",
  LITE: "semis",
  AMAT: "semis",
  LRCX: "semis",
  KLAC: "semis",
  MU: "semis",
  TSM: "semis",
  ASML: "semis",
  ARM: "semis",
  MSFT: "hyperscalers/cloud",
  GOOGL: "hyperscalers/cloud",
  AMZN: "hyperscalers/cloud",
  META: "hyperscalers/cloud",
  ORCL: "hyperscalers/cloud",
  AAPL: "consumer tech",
  TSLA: "consumer tech",
  NFLX: "consumer tech",
  APP: "software",
  RDDT: "software",
  HUBS: "software",
  NOW: "software",
  TWLO: "software",
  DOCN: "software",
  CRM: "software",
  PLTR: "software",
  SNOW: "software",
  DDOG: "software",
  CRWD: "software",
  PANW: "software",
  HOOD: "fintech",
};

const TICKERS_BY_SECTOR = Object.entries(SECTORS).reduce<Record<string, string[]>>((acc, [ticker, sector]) => {
  (acc[sector] ??= []).push(ticker);
  return acc;
}, {});

/** Returns the sector and up to 5 peers (same sector, map order) for a ticker. */
export function sectorOf(ticker: string): { sector: string; peers: string[] } {
  const sector = SECTORS[ticker.toUpperCase()];
  if (!sector) return { sector: "Unclassified", peers: [] };
  return { sector, peers: (TICKERS_BY_SECTOR[sector] ?? []).filter((t) => t !== ticker.toUpperCase()).slice(0, 5) };
}
