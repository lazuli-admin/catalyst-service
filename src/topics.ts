/**
 * Topic map for Federal Register relevance: relevance is decided by TOPIC, never agency.
 * Tickers are hand-curated, illustrative, and reviewed manually.
 */
import { consentPartyTickers } from "./company-universe.js";
export interface Topic {
  id: string;
  label: string;
  patterns: RegExp[];
  themes: string[];
  affectedTickers: string[];
}

export const TOPICS: Topic[] = [
  {
    id: "semis-export-controls",
    label: "Semiconductor export controls",
    patterns: [/semiconductor|integrated circuit|advanced comput|supercomput|foundry|\bchips?\b|entity list|\bIC designer|AI chip|end-user controls|affiliates? (of|rule)[^.]{0,40}(listed|entit|end[- ]user)|(50|fifty)[- ]percent rule/i],
    themes: ["semiconductor export controls"],
    affectedTickers: ["NVDA", "AMD", "AMAT", "LRCX", "KLAC", "ASML", "TSM", "MU"],
  },
  {
    id: "carbon-border-eu-trade",
    label: "Carbon border (CBAM) / EU trade",
    patterns: [/carbon border|\bCBAM\b|european union.{0,60}trade|EU trade/i],
    themes: ["carbon border / EU trade"],
    // tickers are hand-curated, illustrative (steel, aluminum, cement, fertilizer)
    affectedTickers: ["NUE", "STLD", "CLF", "AA", "CENX", "VMC", "MLM", "CF", "MOS"],
  },
  {
    id: "critical-minerals",
    label: "Critical minerals",
    patterns: [/critical mineral|critical materials?|defense (supply chains?|industrial base)|rare earth|\bDPAS\b|lithium|cobalt|graphite|gallium|germanium/i],
    themes: ["critical minerals"],
    affectedTickers: ["MP", "ALB", "LAC"],
  },
  {
    id: "steel-aluminum-copper",
    label: "Steel, aluminum & copper",
    patterns: [/section 232.{0,40}(steel|alumin|copper)|(steel|aluminum|copper) (tariff|import|derivative)/i],
    themes: ["metals tariffs"],
    affectedTickers: ["NUE", "STLD", "CLF", "X", "AA", "CENX", "FCX"],
  },
  {
    id: "autos",
    label: "Autos",
    patterns: [/automobile|auto parts|light truck|vehicles? tariff/i],
    themes: ["autos"],
    affectedTickers: ["GM", "F", "TSLA", "STLA", "TM"],
  },
  {
    id: "pharma",
    label: "Pharma",
    patterns: [/pharmaceutical|drug pricing|prescription drug|pharmacy benefit|\bPBM\b|Express Scripts|insulin/i],
    themes: ["pharma"],
    affectedTickers: ["LLY", "PFE", "MRK", "ABBV", "JNJ", "CI", "CVS", "UNH"],
  },
  {
    id: "solar-polysilicon",
    label: "Solar & polysilicon",
    patterns: [/polysilicon|solar cell|photovoltaic|\bsolar\b/i],
    themes: ["solar"],
    affectedTickers: ["FSLR", "ENPH"],
  },
  {
    id: "wind",
    label: "Wind",
    patterns: [/wind turbine|offshore wind/i],
    themes: ["wind energy"],
    affectedTickers: ["GEV", "NEE"],
  },
  {
    id: "drones",
    label: "Drones",
    patterns: [/\bdrones?\b|unmanned aircraft|\bUAS\b/i],
    themes: ["drones"],
    affectedTickers: ["AVAV", "KTOS", "RCAT"],
  },
  {
    id: "robotics",
    label: "Robotics",
    patterns: [/robotic/i],
    themes: ["robotics"],
    affectedTickers: ["ISRG", "TER", "ROK"],
  },
  {
    id: "shipping-maritime",
    label: "Shipping & maritime",
    patterns: [/shipbuilding|maritime|port fees|vessel fees|ship-to-shore crane/i],
    themes: ["shipping & maritime"],
    affectedTickers: ["ZIM", "MATX", "HII", "GD"],
  },
  {
    id: "lumber",
    label: "Lumber",
    patterns: [/lumber|softwood|timber/i],
    themes: ["lumber"],
    affectedTickers: ["WY", "PCH"],
  },
  {
    id: "de-minimis",
    label: "De minimis",
    patterns: [/de minimis|low-value shipments?|postal informal entry/i],
    themes: ["de minimis"],
    affectedTickers: ["AMZN", "PDD", "ETSY", "EBAY"],
  },
  {
    id: "crypto",
    label: "Crypto",
    patterns: [/crypto|digital asset|stablecoin|blockchain/i],
    themes: ["crypto"],
    affectedTickers: ["COIN", "HOOD", "MSTR"],
  },
  {
    id: "proxy-shareholder",
    label: "Proxy & shareholder rules",
    patterns: [/proxy|shareholder proposal|14a-8/i],
    themes: ["shareholder rules"],
    affectedTickers: [],
  },
  {
    id: "telecom-spectrum",
    label: "Telecom & spectrum",
    patterns: [/spectrum|C-band|broadband|satellite|space (modernization|launch|station)|net neutrality|\bGHz\b/i],
    themes: ["telecom"],
    affectedTickers: ["T", "VZ", "TMUS", "SATS", "ASTS"],
  },
  {
    id: "banking-capital",
    label: "Banking capital",
    patterns: [/capital requirements|Basel|supplementary leverage|stress capital/i],
    themes: ["banking capital"],
    affectedTickers: ["JPM", "BAC", "C", "WFC", "GS", "MS"],
  },
  {
    id: "energy-lng",
    label: "Energy & LNG",
    patterns: [/\bLNG\b|liquefied natural gas|crude oil export|petroleum/i],
    themes: ["energy exports"],
    affectedTickers: ["LNG", "CQP", "XOM"],
  },
  {
    id: "ai-datacenters",
    label: "AI & data centers",
    // \bAI\b only counts when followed by an export/chip/model/computing qualifier.
    patterns: [/artificial intelligence|data cent(er|re)|\bAI\b(?=.{0,60}(?:export|chip|model|comput))/i],
    themes: ["ai & data centers"],
    affectedTickers: ["MSFT", "GOOGL", "AMZN", "META", "ORCL"],
  },
  {
    id: "consumer-retail-tariffs",
    label: "Consumer & retail",
    patterns: [/online food delivery|junk fees?|import disclosure|supply chain visibility/i],
    themes: ["consumer & retail"],
    affectedTickers: ["DASH", "UBER", "WMT", "TGT"],
  },
  {
    id: "trade-remedy",
    label: "Trade remedies (AD/CVD)",
    patterns: [/(negative|affirmative) (preliminary |final )?(countervailing (duty )?)?determination|affirmative (preliminary |final )?countervailing|initiation of (less[- ]than[- ]fair[- ]value|countervailing duty|antidumping duty) investigations?|sales at (not )?less[- ]than[- ]fair[- ]value|not being, or not likely to be, sold at less than fair value|antidumping duty order|countervailing duty order|antidumping and countervailing duty orders/i],
    themes: ["trade remedies"],
    // tickers are hand-curated, illustrative (rebar/steel, solar, trailers)
    affectedTickers: ["NUE", "STLD", "CMC", "FSLR", "WNC"],
  },
  {
    id: "swaps-margining",
    label: "Swaps & margining",
    patterns: [
      // bare "swap(s)" with general negative lookarounds to drop swap data repositories, currency/liquidity swaps, swap lines, and fund-affiliate swaps
      /(?<!debt[- ]for[- ]nature |(?<!cross[- ])currency[- ]|liquidity[- ])\bswaps?\b(?!\s*(?:data repositor|lines?|with affiliated))|security-based swap|portfolio margin|cross-margin|clearing requirement determinations?|clearing agenc(y|ies)\s+(rules?|registration|standards|risk management|regulation)|registration as a clearing agency|covered clearing agenc|standards for covered clearing agenc/i,
    ],
    themes: ["derivatives markets"],
    // tickers are hand-curated, illustrative
    affectedTickers: ["CME", "ICE", "CBOE", "GS", "MS"],
  },
  {
    id: "submarine-cables",
    label: "Submarine cables & network security",
    patterns: [
      /^(?![\s\S]*\b(environmental assessments?|environmental impact statements?|EIS|finding of no significant impact|FONSI)\b)[\s\S]*(submarine|undersea|subsea)\W+(\w+\W+){0,3}cables?/i,
      // "cable landing" only when it is a regulatory/telecom action (e.g. license issuance or related rules)
      /^(?![\s\S]*\b(environmental assessments?|environmental impact statements?|EIS|finding of no significant impact|FONSI)\b)[\s\S]*(?:cable landing (licen[cs]e|rules|act|applications?|stations?)|licen[cs]e[^.]{0,40}cable landing)/i,
    ],
    themes: ["submarine cables"],
    // tickers are hand-curated, illustrative
    affectedTickers: ["GLW", "CIEN", "META", "GOOGL"],
  },
  {
    id: "usmca-trade-agreements",
    label: "USMCA / trade agreements",
    // bare "free trade agreement" also hit routine rules-of-origin / textile notices (e.g. Bahrain, CAFTA-DR); require a material action
    patterns: [/\bUSMCA\b|united states[-–—]mexico[-–—]canada|u\.?s\.?[-–—]mexico[-–—]canada|agreement between the united states of america, the united mexican states, and canada|(negotiat|implement|terminat|withdraw|suspen|renegotiat|modif)\w*[^.]{0,60}free trade agreement|free trade agreement[^.]{0,60}(negotiat|terminat|withdraw|suspen|joint review)/i],
    themes: ["trade agreements"],
    affectedTickers: [],
  },
  {
    id: "foreign-issuer-disclosure",
    label: "Foreign issuer disclosure",
    patterns: [/holding foreign (insiders|companies) accountable|\bHFCAA\b|foreign private issuers?/i],
    themes: ["foreign issuer disclosure"],
    // tickers are hand-curated, illustrative (US-listed foreign private issuers)
    affectedTickers: ["BABA", "PDD", "JD", "BIDU", "NIO"],
  },
  {
    id: "exchange-products-listings",
    label: "Exchange products & listings",
    patterns: [
      // listed crypto/digital-asset ETFs, ETPs, trusts and their shares
      /(crypto|digital[- ]asset|bitcoin|ether(eum)?|solana)[^.;]{0,60}(ETF|ETP|exchange-traded|trust|shares)/i,
      /commodity[- ]based trust shares?/i,
      // options on ETFs/trusts holding crypto
      /options?[^.;]{0,40}(ETF|trust)[^.]{0,30}(holding|that hold)[^.;]{0,20}(crypto|bitcoin|digital asset)/i,
      /tokenized securities|tokeniz(ation|ed form)/i,
      /generic listing (standards?|criteria)|continued listing (standards?|requirements?)/i,
      /\bevent contracts?\b/i,
      // index options expiring on additional days (keep scoped to options/expirations)
      /(options|expir\w*)[^.;]{0,80}(Monday|Tuesday|Wednesday|Thursday|Friday|daily|end-of-month)/i,
      /position (and|or) exercise limits/i,
    ],
    themes: ["exchange products"],
    // illustrative: COIN, HOOD, CME, ICE, NDAQ, CBOE, IBIT
    affectedTickers: [],
  },
  {
    id: "china-trade",
    label: "China trade",
    patterns: [/\bChin(?:a|ese)\b|\bPRC\b/i],
    themes: ["china"],
    affectedTickers: [],
  },
  {
    id: "tariffs-301-232",
    label: "Tariffs (301/232)",
    patterns: [
      /section 301|section 232|\bIEEPA\b|reciprocal tariff|product exclusions?|tariff (actions?|modification|increase)|acts, policies,? and practices|trade act of 1974/i,
      // bare "section 122" also names SRO rulebook sections; require trade context
      /section 122\b[^.;]{0,80}(trade act|balance[- ]of[- ]payments|tariffs?|import surcharge|duties)|(trade act|balance[- ]of[- ]payments|tariffs?|import surcharge)[^.;]{0,80}section 122\b/i,
    ],
    themes: ["tariffs"],
    affectedTickers: [],
  },
];

// routine AD/CVD case administration (reviews, results, rescissions, scope rulings, court decisions);
// new preliminary/final determinations and orders are NOT noise and are picked up by the trade-remedy topic.
// A Section 232 title overrides this pattern only (see isNoise).
export const AD_CVD_RE =
  /administrative reviews?|results of (the )?(antidumping|countervailing|expedited|changed circumstances|sunset)|rescission of (the )?(antidumping|countervailing|administrative|new shipper|.{0,40}review)|scope ruling|sunset reviews?|new shipper|changed circumstances review|continuation of (antidumping|countervailing)|covered merchandise referral|notice of court decision|circumvention inquir|anticircumvention|final results|preliminary results|extension of (the )?time limit|revocation of (the )?(antidumping|countervailing|.{0,30}order)/i;

// AD/CVD procedural scheduling notices are noise only when the postponement is the whole action;
// a title that also announces an affirmative or negative determination is substantive (kept via trade-remedy).
export const ADCVD_PROCEDURAL_RE =
  /^(?!.*(?:affirmative|negative)[^]{0,40}determination|.*determination[^]{0,20}(?:affirmative|negative)).*(?:postponement of (?:preliminary|final) determinations?|extension of (?:the )?deadline for determining (?:the )?adequacy of (?:the )?(?:antidumping|countervailing) duty petition)/i;

/** Purely administrative SEC rulemaking titles (infrastructure, paperwork, fee rates, standalone technical amendments). */
export const SEC_ADMIN_LOW_IMPACT_RE =
  /edgar filer manual|inline xbrl|electronic (delivery|submission|filing)s?\b|filing fee rate|fee rate advisory|^technical amendments?\b(?!.*\b(and|&)\s+\w)|^[^:;]{0,60}[:;]\s*technical amendments?$/i;

/** One shared routine-paperwork noise list, applied to every agency. */
export const NOISE_PATTERNS: RegExp[] = [
  AD_CVD_RE,
  ADCVD_PROCEDURAL_RE,
  /information collection|submission (to|for) (the )?OMB|paperwork reduction/i,
  /^sunshine act/i,
  // SRO noise only: routine procedural/admin filings (fees, timing, technical/clarifying/conforming tweaks), not substantive rule filings.
  /^self-regulatory organizations\b.*(\bfees?\b|fee schedule|pricing|technical (changes?|amendments?)|conforming (changes?|amendments?))/i,
  // SEC procedural timing notices, regardless of SRO prefix (advance notices, review-period extensions)
  /designation of (a )?longer period|extension of (the )?(review period|time)\b/i,
  // SRO filings where a clarification is the whole change (kept when paired with substantive words like adopt/establish/list and trade/listing/amend ... listing)
  /^self-regulatory organizations\b(?!.*\b(adopt|establish|list and trade|listing (standards?|requirements?|rules?)|amend[^;]{0,40}listing)\b).*(\bto clarify\b|\bclarifying (changes?|amendments?)\b)/i,
  /petition for rulemaking|petition for reconsideration/i,
  /commercial gauger|commercial laborator/i,
  /list of rules to be reviewed/i,
  /; correction$|^correction/i,
  /tariff-rate quota/i,
  /denying export privileges|temporary denial|denial of export privileges/i,
  /privacy act of 1974/i,
  /advisory committee/i,
  /performance review board/i,
  // drops routine FTA textile short-supply / commercial-availability procedural notices (e.g. CAFTA-DR)
  /short[- ]supply|commercial availability/i,
  // marine-mammal incidental take authorizations (e.g. for cable landing construction)
  /incidental take|marine mammals?/i,
  // annual presidential continuation notices ("Continuation of the National Emergency With Respect to ...")
  /^continuation of the national emergency\b(?![^]*\band\s+(?:expan|modif|amend|impos|addition|new))/i,
  // technical corrections are noise only when the correction is the whole change (kept when paired with additions, e.g. "and Technical Corrections" or "Technical Correction and ...")
  /^(?!.*(\btechnical corrections?\s+(and|&)\s+\w|\b(and|&)\s+technical corrections?\b)).*\btechnical corrections?\b/i,
  // USMCA/NAFTA binational panel procedure: roster applications, calls for applications, and panel-review docket notices
  /\bbinational panels?\s+roster\b|\bapplications?\s+for\s+inclusion\s+on\b.{0,80}\broster\b|\bcall\s+for\s+applications\b|(?:usmca|nafta|binational panel)[^;]{0,80};?\s*(?:notice of\s+)?(?:request for panel review|completion of panel review|termination of panel review|first request for panel review)\b/i,
];

export interface FrDoc {
  title: string;
  abstract?: string | null;
  type?: string | null;
  agency?: string;
  agencyLabel?: string;
  documentNumber?: string;
}

export function classifyTopics(text: string): Topic[] {
  return TOPICS.filter((t) => t.patterns.some((p) => p.test(text)));
}

export function isNoise(doc: FrDoc): boolean {
  if (doc.documentNumber && /^C\d-/.test(doc.documentNumber)) return true; // correction documents
  const s232 = /section 232/i.test(doc.title);
  const text = doc.title;
  // low-impact SEC administration (EDGAR/XBRL infrastructure, electronic submission, fee rates,
  // standalone technical amendments) — scoped to SEC only
  if (doc.agencyLabel === "SEC" && SEC_ADMIN_LOW_IMPACT_RE.test(text)) return true;
  for (const p of NOISE_PATTERNS) {
    if (p === AD_CVD_RE && s232) continue; // Section 232 titles override AD/CVD paperwork noise only
    if (p.test(text)) return true;
  }
  return false;
}

// Ceremonial/proclamation presidential documents (commemorations, honors, flag half-staff, holiday closings) are kept by default:
// presidential relevance needs no topic, only absence of ceremony.
const CEREMONIAL_PRESIDENTIAL_PARTS = [
  "^national\\b[^;]{0,80}\\b(?:day|week|month|year)\\b",
  "\\b(?:day|week|month)\\b,?\\s+\\d{4}$",
  "\\b(?:day|week|month)\\s+of\\s+(?:prayer|remembrance|observance|recognition|thanksgiving|mourning)\\b",
  "\\bobservance\\b",
  "\\banniversary\\b",
  "\\bhonou?ring\\b",
  "\\bin\\s+(?:memory|honou?r)\\s+of\\b",
  "\\bdeath\\s+of\\b",
  "\\bhalf[- ]staff\\b",
  "\\bflags?\\b.{0,40}\\bhalf\\b",
  "\\bclosing\\s+of\\s+executive\\s+departments\\b",
  "\\bthanksgiving\\s+day\\b",
  // ceremonial alternatives: named holidays/observances
  "\\bfederal\\s+holiday\\b",
  "\\bday\\s+of\\s+remembrance\\b|\\bremembrance\\s+day\\b",
  "\\b(?:memorial|columbus|veterans?|independence|flag|loyalty|patriot|father'?s|mother'?s)\\s+day\\b",
  "\\bpearl\\s+harbor\\s+remembrance\\b",
  "\\bgold\\s+star\\b",
  "\\bcommemorat(?:e|ing|ion)\\b",
  // "Celebrating"/"Celebration of" only when tied to an anniversary/heritage/day/week/month/year in the same clause
  "\\b(?:celebrating|celebration\\s+of)\\b[^;.]{0,80}\\b(?:anniversary|heritage|day|week|month|year)\\b",
];
export const CEREMONIAL_PRESIDENTIAL_RE = new RegExp(CEREMONIAL_PRESIDENTIAL_PARTS.join("|"), "i");

export function isCeremonialPresidential(doc: FrDoc): boolean {
  return doc.type === "Presidential Document" && CEREMONIAL_PRESIDENTIAL_RE.test(doc.title);
}

// OMB/PRA paperwork approvals are administrative, not substantive rulemaking.
export const OMB_APPROVAL_RE = /\bomb\s+approval\b|\bapproval\s+of\s+(?:an\s+)?information\s+collection\b/i;
const OMB_EFFECTIVE_DATE_RE = /announcement of (?:effective|compliance) date$/i;
const OMB_MENTION_RE = /\bomb\b|office of management and budget|information collection|paperwork reduction/i;

// isNoise only sees the title, so the abstract-based OMB/PRA check lives here (called from isRelevant).
export function isOmbApprovalNotice(doc: FrDoc): boolean {
  if (OMB_APPROVAL_RE.test(doc.title)) return true;
  if (!OMB_EFFECTIVE_DATE_RE.test(doc.title)) return false;
  return OMB_MENTION_RE.test(`${doc.title} ${doc.abstract ?? ""}`);
}

// Administrative presidential actions: advisory-committee continuations and federal pay adjustments.
export const ADMIN_PRESIDENTIAL_RE =
  /\bcontinuance of certain federal advisory committees\b|^(?!.*\b(?:impos|modif|amend|establish|suspen|terminat|expand|adjust|prohibit|block|revok)).*\bcontinuing the\b[^;.]{0,80}\b(?:council|committee|commission|board)s?\b|\badjustments?\s+(?:of|to)\b.{0,60}\brates?\s+of\s+pay\b/i;

export function isAdministrativePresidential(doc: FrDoc): boolean {
  return doc.type === "Presidential Document" && ADMIN_PRESIDENTIAL_RE.test(doc.title);
}

// SRO filings (titles starting "Self-Regulatory Organizations;") are not relevant by default: they are
// kept only when they hit a high-weight topic (crypto, exchange products/listings, or swaps-margining
// narrowed to Treasury clearing / cross-margining / clearing agency), name a new exchange/listing venue,
// or their TITLE announces a new product listing or an options/derivative listing (SRO_NEW_PRODUCT_LISTING_RE).
export const SRO_TITLE_RE = /^self-regulatory organizations\b/i;
export const SRO_HIGH_WEIGHT_TOPICS = ["exchange-products-listings", "crypto", "swaps-margining"];
// bare "swap" is excluded for SRO filings — only clearing/cross-margining counts
const SRO_CLEARING_RE =
  /treasury clearing|cross-margin|registration as a clearing agency|covered clearing agenc|clearing agenc(y|ies)\s+(rules?|registration|standards|risk management|regulation)/i;
export const SRO_NEW_VENUE_RE = /registration as a national securities exchange|form 1\b(?!-)|new exchange/i;
// new-product and options/derivative listing proposals (TITLE-only match):
// (a) new product listing phrasings; (b) options on/binary options/index options co-occurring with list|listing|trade
export const SRO_NEW_PRODUCT_LISTING_RE =
  /to permit the (?:generic )?listing(?: and trading)? of\b|to list and trade\b|to adopt (?:generic )?listing standards\b|listing standards for\b|generic listing\b|(?:(?:binary |index )?options on|binary options|index options)(?=[^;]{0,120}\b(?:list|listing|trade)\b)/i;

export function isExchangeRegistrationAck(doc: FrDoc): boolean {
  return /^acknowledge?ment of receipt of notice of registration as a national securities exchange/i.test(doc.title);
}

export function isSroFiling(doc: FrDoc): boolean {
  if (!SRO_TITLE_RE.test(doc.title)) return false;
  const text = `${doc.title} ${doc.abstract ?? ""}`;
  const matched = classifyTopics(text).map((t) => t.id);
  if (SRO_HIGH_WEIGHT_TOPICS.some((id) => matched.includes(id) && (id !== "swaps-margining" || SRO_CLEARING_RE.test(text)))) {
    return true;
  }
  return SRO_NEW_VENUE_RE.test(text) || SRO_NEW_PRODUCT_LISTING_RE.test(doc.title);
}

export function isRelevant(doc: FrDoc): boolean {
  if (isNoise(doc)) return false;
  if (isExchangeRegistrationAck(doc)) return true;
  if (SRO_TITLE_RE.test(doc.title)) return isSroFiling(doc);
  if (doc.type === "Presidential Document") {
    // Known false positive (not fixed): water-quality-type EOs are kept by default though labeled not relevant.
    return !isCeremonialPresidential(doc) && !isAdministrativePresidential(doc);
  }
  if (consentPartyTickers(doc.title).length > 0) return true;
  return classifyTopics(`${doc.title} ${doc.abstract ?? ""}`).length > 0;
}

export function topicTags(doc: FrDoc): { themes: string[]; affectedTickers: string[]; topics: string[] } {
  const matched = classifyTopics(`${doc.title} ${doc.abstract ?? ""}`);
  return {
    themes: [...new Set(matched.flatMap((t) => t.themes))],
    affectedTickers: [
      ...new Set([...matched.flatMap((t) => t.affectedTickers), ...consentPartyTickers(doc.title).map((m) => m.ticker)]),
    ],
    topics: matched.map((t) => t.id),
  };
}
