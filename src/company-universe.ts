import { PRESET_PILLARS, PRESET_TRADES } from "./presets.js";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  sec?: boolean;
}

export interface SecCompany { cik: number; ticker: string; title: string }
export const SEC_COMPANIES: SecCompany[] = (() => {
  try {
    return (JSON.parse(readFileSync(path.join(process.cwd(), "data", "sec-company-tickers.json"), "utf8")) as { companies?: SecCompany[] }).companies ?? [];
  } catch {
    return [];
  }
})();

export function buildSecUniverse(rows: SecCompany[]): UniverseCompany[] {
  const out: UniverseCompany[] = [];
  for (const r of rows) {
    const names = [normalizeCompanyName(r.title)].filter(Boolean);
    if (!names.length) continue;
    out.push({ name: r.title, ticker: r.ticker, names, sec: true });
  }
  return out;
}

const ORG_RE = /commission|department|federal reserve|fomc|congress|court|bank of|treasury|white house|council|office|bureau/i;

export function buildUniverse(
  pillars: Record<string, { entities?: { name: string; aliases?: string[] }[] }> = PRESET_PILLARS,
  sec: SecCompany[] = SEC_COMPANIES,
): UniverseCompany[] {
  const secByName = new Map<string, string>();
  for (const r of sec) {
    const norm = normalizeCompanyName(r.title);
    if (norm && !secByName.has(norm)) secByName.set(norm, r.ticker);
  }
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
    // fund issuers map to the parent company (BlackRock -> BLK, not its ETF IBIT)
    const ticker = secByName.get(normalizeCompanyName(name)) ?? [name, ...aliases].find((n) => tradable.has(n));
    if (!ticker) continue;
    const names = [name, ...aliases.filter((a) => a !== ticker)]
      .map((n) => normalizeCompanyName(n))
      .filter((n) => n.length >= 4);
    universe.push({ name, ticker, names });
  }
  return universe;
}

const preset = buildUniverse();
const presetTickers = new Set(preset.map((c) => c.ticker));
export const COMPANY_UNIVERSE = [...preset, ...buildSecUniverse(SEC_COMPANIES).filter((c) => !presetTickers.has(c.ticker))];

const CONSENT_TITLE_RE = /;\s*analysis of (?:proposed )?(?:agreement|consent order)|consent (?:order|agreement|decree)s?\b|proposed final judgment|competitive impact statement|\bmerger\b|\bacquisition\b/i;

export const COMMON_WORD_NAMES = new Set(["apple", "target", "visa", "gap", "square", "block", "oracle", "amazon", "monster", "match", "shell", "sun", "unity", "snap", "ball", "crown", "fox", "news", "global", "general", "united", "american", "first", "national"]);
export const EXPLICIT_CONSENT_RE = /;\s*analysis of (?:proposed )?(?:agreement|consent order)|consent (?:order|agreement|decree)s?\b|proposed final judgment|\bmerger\b/i;
const SUFFIX_IN_PARTY_RE = /\b(?:inc|incorporated|corp|corporation|co|company|plc|ltd|limited|llc|l\.?p|holdings?|group)\b\.?\s*$/i;
const isShortOrCommon = (norm: string): boolean => norm.length < 6 || COMMON_WORD_NAMES.has(norm);

const secPrefixesCache = new WeakMap<UniverseCompany[], Map<string, Set<string>>>();
function secPrefixes(universe: UniverseCompany[]): Map<string, Set<string>> {
  let cache = secPrefixesCache.get(universe);
  if (cache) return cache;
  cache = new Map();
  for (const c of universe) {
    if (!c.sec) continue;
    for (const name of c.names) {
      const words = name.split(" ");
      for (let k = 1; k < words.length; k++) {
        const prefix = words.slice(0, k).join(" ");
        const set = cache.get(prefix) ?? new Set<string>();
        set.add(c.ticker);
        cache.set(prefix, set);
      }
    }
  }
  secPrefixesCache.set(universe, cache);
  return cache;
}

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
    const shortOrCommon = isShortOrCommon(norm);
    if (shortOrCommon && !SUFFIX_IN_PARTY_RE.test(party.trim()) && !EXPLICIT_CONSENT_RE.test(title)) continue;
    const hits = universe.filter((c) => c.names.includes(norm));
    // SEC shares normalized names across tickers (e.g. "target": TGT and CBDY); resolve ambiguity by preset first.
    let hit = hits[0];
    if (new Set(hits.map((c) => c.ticker)).size > 1) {
      const presets = hits.filter((c) => !c.sec);
      hit = presets.length === 1 ? presets[0] : undefined;
    }
    // SEC legal names carry descriptors ("BrightSpring Health Services, Inc."); titles use the short name.
    // A whole-word prefix counts only when unique in the SEC list and the name is not short/common.
    if (!hit && !shortOrCommon) {
      const t = secPrefixes(universe).get(norm);
      if (t && t.size === 1) { const tk = [...t][0]; hit = universe.find((c) => c.ticker === tk); }
    }
    if (hit) matches.set(hit.ticker, hit.name);
  }
  return [...matches].map(([ticker, name]) => ({ ticker, name }));
}
