/** How trustworthy a catalyst's source is: 1 = primary (newswires, IR, .gov), 2 = reputable press, 3 = everything else. */
export type SourceTier = 1 | 2 | 3;

const TIER1_DOMAINS = ["sec.gov", "federalregister.gov", "businesswire.com", "prnewswire.com", "globenewswire.com", "accesswire.com"];
const TIER2_DOMAINS = ["reuters.com", "bloomberg.com", "wsj.com", "ft.com", "cnbc.com", "apnews.com", "nytimes.com", "barrons.com", "theinformation.com", "nikkei.com", "marketwatch.com", "axios.com", "semafor.com"];

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

// Match the domain itself or any subdomain ("uk.reuters.com" -> reuters.com), so "notreuters.com" never matches.
const matches = (host: string, list: string[]): boolean => list.some((d) => host === d || host.endsWith(`.${d}`));

export function sourceTier(input: { url?: string | null; title?: string }): SourceTier {
  if (!input.url) return 3;
  const host = hostOf(input.url);
  if (!host) return 3;

  if (host.endsWith(".gov")) return 1;
  if (matches(host, TIER1_DOMAINS)) return 1;
  if (host.startsWith("ir.") || host.startsWith("investor")) return 1;
  if (matches(host, TIER2_DOMAINS)) return 2;

  // Google News wraps the real article; the publisher is the suffix after the last " - " in the title.
  if (host.endsWith("news.google.com")) {
    const title = input.title ?? "";
    const parts = title.split(" - ");
    const publisher = (parts.length > 1 ? (parts.at(-1) ?? "") : "").trim().toLowerCase();
    const tier1Publishers = ["business wire", "pr newswire", "globenewswire"];
    const tier2Publishers = ["reuters", "bloomberg", "the wall street journal", "wsj", "financial times", "cnbc", "ap news", "associated press", "the new york times", "barron's", "the information", "nikkei asia", "marketwatch", "axios", "semafor"];
    if (tier1Publishers.includes(publisher)) return 1;
    if (tier2Publishers.includes(publisher)) return 2;
  }

  return 3;
}

/** calendar = a primary-source calendar entry, lead = stored but hidden until a primary source confirms, false = reject. */
export type AcceptDecision = "calendar" | "lead" | false;

export function acceptCatalyst(c: { dateStart: string; confidence: number }, tier: SourceTier, today: string): AcceptDecision {
  // Only verified sources: tier 3 is never accepted.
  if (tier === 3) return false;
  const days = (Date.parse(c.dateStart) - Date.parse(today)) / 86_400_000;
  if (days > 730) return false;
  // Tier 2 press never enters the calendar directly, only as a lead.
  if (tier === 2) return c.confidence >= (days > 90 ? 0.7 : 0.4) ? "lead" : false;
  if (days > 90) return c.confidence >= 0.5 ? "calendar" : false;
  return c.confidence >= 0.4 ? "calendar" : false;
}
