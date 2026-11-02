/** How trustworthy a catalyst's source is: 1 = primary (official/.gov, IR), 2 = press incl. newswire releases, 3 = everything else. */
export type SourceTier = 1 | 2 | 3;

const TIER1_DOMAINS = ["sec.gov", "federalregister.gov", "govinfo.gov", "federalreserve.gov"];
// Newswire press releases: always tier 2, never tier 1 — a wire release is not an official source.
const WIRE_DOMAINS = ["prnewswire.com", "businesswire.com", "globenewswire.com", "accesswire.com", "newsfilecorp.com", "einpresswire.com", "prweb.com", "newswire.com", "issuewire.com"];

export function isWireSource(url: string | null | undefined): boolean {
  if (!url) return false;
  const host = hostOf(url);
  return host !== "" && matches(host, WIRE_DOMAINS);
}
const TIER2_DOMAINS = ["reuters.com", "bloomberg.com", "wsj.com", "ft.com", "cnbc.com", "apnews.com", "nytimes.com", "barrons.com", "theinformation.com", "nikkei.com", "marketwatch.com", "axios.com", "semafor.com", "nasdaq.com"];

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
  if (isWireSource(input.url)) return 2; // wire check precedes the tier-1 list: wires are never official
  if (matches(host, TIER1_DOMAINS)) return 1;
  if (host.startsWith("ir.") || host.startsWith("investor")) return 1;
  if (matches(host, TIER2_DOMAINS)) return 2;

  // Google News wraps the real article; the publisher is the suffix after the last " - " in the title.
  if (host.endsWith("news.google.com")) {
    const title = input.title ?? "";
    const parts = title.split(" - ");
    const publisher = (parts.length > 1 ? (parts.at(-1) ?? "") : "").trim().toLowerCase();
    const wirePublishers = ["business wire", "pr newswire", "globenewswire", "accesswire"];
    const tier2Publishers = ["reuters", "bloomberg", "the wall street journal", "wsj", "financial times", "cnbc", "ap news", "associated press", "the new york times", "barron's", "the information", "nikkei asia", "marketwatch", "axios", "semafor", ...wirePublishers];
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

/** Canonical dedupe keys for official regulatory events: fr:, policy:, bls:, bea:, fed:. */
export const CANONICAL_KEY_RE = /^(fr|policy|bls|bea|fed):/;

/** The old `ticker|kind|month|title` key format from catalystDedupeKey. */
export function isLegacyTitleKey(key: string): boolean {
  return key.includes("|");
}

/** Server-side trust enforcement: recompute the tier from the URL, then apply regulatory-decision rules. Does not mutate. */
export function enforceTrust<T extends { sourceUrl: string | null; sourceTier: number; kind: string; status: string; dedupeKey: string; title?: string }>(c: T): T | null {
  const tier = sourceTier({ url: c.sourceUrl, title: c.title });
  const next: T = { ...c, sourceTier: tier };
  if (c.kind !== "regulatory_decision") return next;
  // Legacy title keys are never valid for regulatory decisions — they must use a canonical fr:/policy:/bls:/bea:/fed: key.
  if (isLegacyTitleKey(c.dedupeKey)) return null;
  // A wire/press/unknown source cannot vouch for an official regulatory decision: downgrade, never reject outright.
  if (tier !== 1) {
    next.kind = "other";
    if (next.status === "confirmed" || next.status === "scheduled") next.status = "lead";
  }
  return next;
}
