import { certainty, KIND_WEIGHTS, LEAD_MULTIPLIERS, leadBucket, tradingDaysBetween, type LeadBucket } from "./density.js";
import type { Catalyst } from "../types.js";

export interface RankedCatalyst extends Catalyst {
  score: number;
  bucket: LeadBucket;
}

/** Same precision bar as density: exact dates or windows of <=10 trading days. */
export function isPrecise(c: Catalyst): boolean {
  return c.datePrecision === "exact" || (c.datePrecision === "window" && tradingDaysBetween(c.dateStart, c.dateEnd) <= 10);
}

/** Score and bucket catalysts for a ranked default view. Pure. */
export function rankCatalysts(cats: Catalyst[], opts: { asOf: string; all?: boolean }): RankedCatalyst[] {
  const ranked = cats
    .filter((c) => {
      if (opts.all) return true;
      // Default view: only decision-grade, precisely-dated upcoming events.
      if (c.status === "lead" || c.status === "cancelled" || c.status === "done") return false;
      if (Date.parse(c.dateEnd) < Date.parse(opts.asOf)) return false;
      return KIND_WEIGHTS[c.kind] >= 2 && isPrecise(c);
    })
    .map((c) => {
      const bucket = leadBucket(c.dateStart, opts.asOf);
      return { ...c, bucket, score: KIND_WEIGHTS[c.kind] * certainty(c) * LEAD_MULTIPLIERS[bucket] * c.confidence };
    });
  return ranked.sort((a, b) => b.score - a.score || Date.parse(a.dateStart) - Date.parse(b.dateStart) || a.id.localeCompare(b.id));
}
