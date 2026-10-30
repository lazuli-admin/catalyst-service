import { certainty, KIND_WEIGHTS, LEAD_MULTIPLIERS, leadBucket, tradingDaysBetween, type LeadBucket } from "./density.js";
import type { Catalyst } from "../types.js";

export interface RankedCatalyst extends Catalyst {
  score: number;
  bucket: LeadBucket;
  focus?: boolean;
  pinned?: boolean;
  impliedMove?: number;
}

/** Focus tickers: names we always want promoted, boosted 2x. */
export const FOCUS_WATCHLIST = ["NVDA", "AMD", "AVGO", "MSFT", "GOOGL", "AMZN", "META", "AAPL", "AMAT", "LRCX", "KLAC", "APP", "RDDT", "HUBS", "NOW", "TWLO", "DOCN", "ORCL", "MRVL", "LITE", "HOOD"];

/** Macro releases that ride in the default view despite weight 1. */
export const PINNED_MACRO: RegExp[] = [
  /\bcpi\b|consumer price/i,
  /\bpce\b|personal consumption/i,
  /nonfarm|payrolls|jobs report|unemployment rate/i,
  /\bjolts\b/i,
  /\bfomc\b|fed interest rate|interest rate decision/i,
  /initial jobless claims/i,
];

const isPinned = (c: Catalyst) => c.kind === "election" || (c.kind === "macro" && PINNED_MACRO.some((re) => re.test(c.title)));

/** Same precision bar as density: exact dates or windows of <=10 trading days. */
export function isPrecise(c: Catalyst): boolean {
  return c.datePrecision === "exact" || (c.datePrecision === "window" && tradingDaysBetween(c.dateStart, c.dateEnd) <= 10);
}

/** Score and bucket catalysts for a ranked default view. Pure. */
export function rankCatalysts(cats: Catalyst[], opts: { asOf: string; all?: boolean; watchlist?: string[]; impliedMove?: Record<string, number> }): RankedCatalyst[] {
  const watch = new Set((opts.watchlist ?? FOCUS_WATCHLIST).map((s) => s.toUpperCase()));
  const ranked = cats
    .filter((c) => {
      if (opts.all) return true;
      // Default view: decision-grade, precisely-dated upcoming events, plus pinned macro/elections.
      if (c.status === "lead" || c.status === "cancelled" || c.status === "done") return false;
      if (Date.parse(c.dateEnd) < Date.parse(opts.asOf)) return false;
      if (isPinned(c)) return true;
      return KIND_WEIGHTS[c.kind] >= 2 && isPrecise(c);
    })
    .map((c) => {
      const bucket = leadBucket(c.dateStart, opts.asOf);
      const focus = (c.ticker !== null && watch.has(c.ticker)) || c.affectedTickers.some((t) => watch.has(t));
      const im = c.kind === "earnings" ? opts.impliedMove?.[c.ticker ?? ""] : undefined;
      let score = KIND_WEIGHTS[c.kind] * certainty(c) * LEAD_MULTIPLIERS[bucket] * c.confidence;
      if (focus) score *= 2;
      if (im != null) score *= Math.min(3, Math.max(0.5, im / 0.05));
      return {
        ...c,
        bucket,
        score,
        ...(focus ? { focus: true } : {}),
        ...(isPinned(c) ? { pinned: true } : {}),
        ...(im != null ? { impliedMove: im } : {}),
      };
    });
  return ranked.sort((a, b) => b.score - a.score || Date.parse(a.dateStart) - Date.parse(b.dateStart) || a.id.localeCompare(b.id));
}
