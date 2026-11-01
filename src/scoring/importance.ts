// Single scorer for catalyst importance (design item 5).
//
//   score = importance(class) x certainty x confidence
//
// The IMPORTANCE table below is the single source of truth for per-class weights;
// no kind-tier table, pinned list or per-row weight override participates anymore.
// Focus boost: earnings of watchlist names are boosted x1.5 (FOCUS_MULTIPLIER), applied in
// catalysts/ranked.ts after scoreEvent — not part of the table or the functions here.
// Default view: only catalysts scoring >= DEFAULT_VIEW_MIN_SCORE (4.0) are shown.
// All functions are pure: no I/O, no clock, no randomness.

import type { Catalyst } from "../types.js";

export type EventClass =
  | "fomc"
  | "cpi"
  | "nfp"
  | "pce"
  | "gdp"
  | "ppi"
  | "jolts"
  | "retail_sales"
  | "jobless_claims"
  | "central_bank_other"
  | "macro_other"
  | "election_federal"
  | "election_other"
  | "policy_decision"
  | "policy_suspension_end"
  | "policy_comment_close"
  | "policy_reply_or_rfi"
  | "policy_update_due"
  | "policy_other"
  | "earnings_mega"
  | "earnings_large"
  | "corporate_major"
  | "corporate_minor"
  | "other";

/** Importance per event class; the single source of truth for scoring weights. */
export const IMPORTANCE: Record<EventClass, number> = {
  // Macro releases
  fomc: 10,
  // Non-US central bank policy decisions (ECB/BoJ/BoE/BoC/SNB/RBA etc.); moves global rates but less than FOMC.
  central_bank_other: 4,
  cpi: 8,
  nfp: 8,
  pce: 6,
  gdp: 6,
  ppi: 4,
  jolts: 4,
  retail_sales: 4,
  jobless_claims: 2,
  macro_other: 1,
  // Elections
  election_federal: 6,
  election_other: 2,
  // Policy / regulatory
  policy_decision: 6,
  policy_suspension_end: 6,
  policy_comment_close: 2,
  // RFI / request-for-comments / reply-comment deadlines: informational, not decisions.
  policy_reply_or_rfi: 1,
  policy_update_due: 1,
  policy_other: 3,
  // Earnings (by market cap tier)
  // NOTE: Market-cap tiers ($200B / $10B) await a stored market cap; until then the calendar sync's
  // megacap theme decides mega vs large, and sub-$10B names are not ingested.
  earnings_mega: 7,
  earnings_large: 4,
  // Corporate events
  corporate_major: 5, // phase3_readout, approval, deal_close, litigation, regulatory_decision w/ ticker, shareholder_vote, patent_decision
  corporate_minor: 3, // lockup_expiry, index_rebalance, buyback_offering, patent_expiry, buildout_completion
  other: 1, // investor_event, product_launch, conference, peer_read_across, other
};

/** Match a macro catalyst to a stable series by dedupeKey prefix, falling back to title regexes. Null if not a known macro series. */
export function macroSeries(c: Pick<Catalyst, "dedupeKey" | "title">): EventClass | null {
  if (c.dedupeKey.startsWith("fed:fomc:")) return "fomc";
  if (c.dedupeKey.startsWith("bls:CPI:")) return "cpi";
  if (c.dedupeKey.startsWith("bls:Jobs report:")) return "nfp";
  if (c.dedupeKey.startsWith("bls:PPI:")) return "ppi";
  if (c.dedupeKey.startsWith("bls:JOLTS:")) return "jolts";
  if (c.dedupeKey.startsWith("bea:PCE:")) return "pce";
  if (c.dedupeKey.startsWith("bea:GDP:")) return "gdp";
  // Fallback for macro rows from other sources (LLM/calendar): classify by title.
  const t = c.title;
  if (/\b(ecb|european central bank|bank of japan|bank of england|bank of canada|swiss national bank|reserve bank of australia|reserve bank of new zealand|people's bank of china|riksbank|norges bank)\b|\b(boj|boe|boc|snb|rba|rbnz|pboc)\b.*\b(rate|policy|monetary)\b/i.test(t)) return "central_bank_other";
  if (/\bfomc\b|\b(fed|federal reserve)\b.*\b(rate|policy) decision/i.test(t)) return "fomc";
  if (/\bcpi\b|consumer price/i.test(t)) return "cpi";
  if (/nonfarm|payrolls|jobs report|employment situation/i.test(t)) return "nfp";
  if (/\bpce\b|personal (income|consumption)/i.test(t)) return "pce";
  if (/\bgdp\b|gross domestic/i.test(t)) return "gdp";
  if (/\bppi\b|producer price/i.test(t)) return "ppi";
  if (/\bjolts\b|job openings/i.test(t)) return "jolts";
  if (/retail sales/i.test(t)) return "retail_sales";
  if (/jobless claims/i.test(t)) return "jobless_claims";
  return null;
}

// Reserved for future per-call context.
export interface ScoreContext {}

/** Classify a catalyst into an EventClass. */
export function classifyEvent(c: Catalyst, ctx: ScoreContext = {}): EventClass {
  if (c.kind === "macro") return macroSeries(c) ?? "macro_other";
  if (c.kind === "election") {
    return /\b(us|federal|presidential|midterm|congress)/i.test(c.title) ? "election_federal" : "election_other";
  }
  if (
    c.dedupeKey.startsWith("policy:") || c.dedupeKey.startsWith("fr:") ||
    c.kind === "rule_effective" || c.kind === "rule_expiry" || c.kind === "comment_close" ||
    c.kind === "presidential_action"
  ) {
    const isCommentClose =
      c.kind === "comment_close" || c.dedupeKey.includes(":comments:") || /comments? (close|due|deadline)/i.test(c.title);
    // RFI/reply-comment deadlines are informational, so classify before the generic comment-close branch.
    if (isCommentClose && /request for (information|comments?)|\bRFI\b|reply comments?/i.test(c.title)) return "policy_reply_or_rfi";
    if (c.kind === "presidential_action") return "policy_decision";
    // A rule lapsing is as consequential as a suspension ending: the tariff/regulatory state changes.
    if (c.kind === "rule_expiry") return "policy_suspension_end";
    if (isCommentClose) return "policy_comment_close";
    if (/update due/i.test(c.title)) return "policy_update_due";
    if (/suspension (ends|end|expires)|exclusions? end|\bends\b/i.test(c.title)) return "policy_suspension_end";
    if (c.kind === "rule_effective" || c.kind === "regulatory_decision" || /effective|proclamation|decision|deadline|final rule/i.test(c.title)) {
      return "policy_decision";
    }
    return "policy_other";
  }
  if (c.kind === "earnings") {
    return c.themes.includes("megacap") ? "earnings_mega" : "earnings_large";
  }
  if (
    c.kind === "phase3_readout" ||
    c.kind === "approval" ||
    c.kind === "deal_close" ||
    c.kind === "litigation" ||
    (c.kind === "regulatory_decision" && c.ticker !== null) ||
    c.kind === "shareholder_vote" ||
    c.kind === "patent_decision"
  ) {
    return "corporate_major";
  }
  if (
    c.kind === "lockup_expiry" ||
    c.kind === "index_rebalance" ||
    c.kind === "buyback_offering" ||
    c.kind === "patent_expiry" ||
    c.kind === "buildout_completion"
  ) {
    return "corporate_minor";
  }
  return "other";
}

/** Multiplier by how precisely the date is known. */
export const CERTAINTY = { exact: 1.0, window: 0.7, wideWindow: 0.4, estimated: 0.4 };

/** Local copy of tradingDaysBetween (kept identical to density.ts to avoid a circular import). */
function weekdayCount(a: string, b: string): number {
  let count = 0;
  for (let d = Date.parse(a); d < Date.parse(b); d += 86_400_000) {
    const day = new Date(d).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/** Date-certainty multiplier: exact dates or windows of <=10 trading days count as reliable. */
export function certaintyOf(c: Catalyst): number {
  if (c.datePrecision === "exact") return CERTAINTY.exact;
  if (c.datePrecision === "window") return weekdayCount(c.dateStart, c.dateEnd) <= 10 ? CERTAINTY.window : CERTAINTY.wideWindow;
  return CERTAINTY.estimated;
}

/** Importance weight for a catalyst. */
export function importanceOf(c: Catalyst, ctx: ScoreContext = {}): number {
  return IMPORTANCE[classifyEvent(c, ctx)];
}

/** Product of the three score factors, each clamped to >= 0. */
export function scoreParts(importance: number, certainty: number, confidence: number): number {
  return Math.max(0, importance) * Math.max(0, certainty) * Math.max(0, confidence);
}

/** Full score for a catalyst: importance(class) x certainty x confidence. */
export function scoreEvent(c: Catalyst, ctx: ScoreContext = {}): number {
  return scoreParts(importanceOf(c, ctx), certaintyOf(c), c.confidence);
}

/** Minimum score for a catalyst to appear in the default (non-all) view; inclusive (PPI/JOLTS at exactly 4 stay in). */
export const DEFAULT_VIEW_MIN_SCORE = 4.0;

/**
 * Macro series always shown in the default view regardless of score.
 * NOT jobless_claims: a weekly release of importance 2, it would flood the view.
 */
export const ALWAYS_SHOWN_MACRO: ReadonlySet<EventClass> = new Set([
  "fomc",
  "cpi",
  "nfp",
  "pce",
  "gdp",
  "ppi",
  "jolts",
  "retail_sales",
  "central_bank_other",
]);

/** True for macro catalysts whose series is always shown in the default view. */
export function isAlwaysShown(c: Catalyst): boolean {
  return c.kind === "macro" && ALWAYS_SHOWN_MACRO.has(classifyEvent(c));
}
