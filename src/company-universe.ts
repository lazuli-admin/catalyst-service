import { PRESET_PILLARS, PRESET_TRADES } from "./presets.js";

// Companies only (agencies/orgs excluded) drawn from the in-code universe in PRESET_PILLARS.
// Used to keep FTC/DOJ consent-order and merger notices that name a watched company.

const CORPORATE_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "plc", "ltd",
  "limited", "llc", "lp", "holdings", "holding", "group", "sa", "ag", "nv", "se",
]);

export function normalizeCompanyName(s: string): string {
  const words = s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  for (;;) {
    const n = words.length;
    const last = words[n - 1];
    if (!last) break;
    if (n >= 2 && words[n - 2] === "l" && last === "p") words.splice(n - 2, 2);
    else if (CORPORATE_SUFFIXES.has(last)) words.pop();
    else break;
  }
  return words.join(" ");
}

export interface UniverseCompany {
  name: string;
  ticker: string;
  names: string[];
}

const ORG_RE = /commission|department|federal reserve|fomc|congress|court|bank of|treasury|white house|council|office|bureau/i;

export function buildUniverse(
  pillars: Record<string, { entities?: { name: string; aliases?: string[] }[] }> = PRESET_PILLARS,
): UniverseCompany[] {
  // merge duplicate entity names across presets (e.g. Alphabet appears in two presets)
  const byName = new Map<string, string[]>();
  for (const preset of Object.values(pillars)) {
    for (const e of preset.entities ?? []) {
      const aliases = (e.aliases ?? []).filter((a) => a !== e.name);
      if (ORG_RE.test(e.name) || aliases.some((a) => ORG_RE.test(a))) continue;
      const merged = byName.get(e.name) ?? [];
      for (const a of aliases) if (!merged.includes(a)) merged.push(a);
      byName.set(e.name, merged);
    }
  }
  // ticker must be one of the tickers actually traded by the presets (prevents Amazon -> AWS style mismatches)
  const tradable = new Set(PRESET_TRADES.flatMap((t) => t.tickers));
  const universe: UniverseCompany[] = [];
  for (const [name, aliases] of byName) {
    const ticker = [name, ...aliases].find((n) => tradable.has(n));
    if (!ticker) continue;
    const names = [name, ...aliases.filter((a) => a !== ticker)]
      .map((n) => normalizeCompanyName(n))
      .filter((n) => n.length >= 4);
    universe.push({ name, ticker, names });
  }
  return universe;
}

export const COMPANY_UNIVERSE = buildUniverse();

const CONSENT_TITLE_RE = /;\s*analysis of (?:proposed )?(?:agreement|consent order)|consent (?:order|agreement|decree)s?\b|proposed final judgment|competitive impact statement|\bmerger\b|\bacquisition\b/i;

export function consentPartyTickers(
  title: string,
  universe: UniverseCompany[] = COMPANY_UNIVERSE,
): { ticker: string; name: string }[] {
  if (!CONSENT_TITLE_RE.test(title)) return [];
  const semi = title.indexOf(";");
  let head = semi >= 0 ? title.slice(0, semi) : title;
  const pfj = head.search(/, proposed final judgment/i);
  if (pfj >= 0) head = head.slice(0, pfj);
  const matches = new Map<string, string>();
  for (const party of head.split(/ and | , | v\.? | et al/i)) {
    const norm = normalizeCompanyName(party);
    if (!norm) continue;
    const hit = universe.find((c) => c.names.includes(norm));
    if (hit) matches.set(hit.ticker, hit.name);
  }
  return [...matches].map(([ticker, name]) => ({ ticker, name }));
}
