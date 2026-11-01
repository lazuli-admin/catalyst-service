import { leadBucket, tradingDaysBetween, type LeadBucket } from "./density.js";
import { scoreEvent, importanceOf, classifyEvent, DEFAULT_VIEW_MIN_SCORE, type EventClass } from "../scoring/importance.js";
import type { Catalyst } from "../types.js";

export interface RankedCatalyst extends Catalyst {
  score: number;
  importance: number;
  eventClass: EventClass;
  bucket: LeadBucket;
  focus?: boolean;
  impliedMove?: number;
}

/** Focus tickers: names we always want promoted, boosted 2x. */
export const FOCUS_WATCHLIST = ["NVDA", "AMD", "AVGO", "MSFT", "GOOGL", "AMZN", "META", "AAPL", "AMAT", "LRCX", "KLAC", "APP", "RDDT", "HUBS", "NOW", "TWLO", "DOCN", "ORCL", "MRVL", "LITE", "HOOD"];

/** Same precision bar as density: exact dates or windows of <=10 trading days. */
export function isPrecise(c: Catalyst): boolean {
  return c.datePrecision === "exact" || (c.datePrecision === "window" && tradingDaysBetween(c.dateStart, c.dateEnd) <= 10);
}

/** Class-suffix and corporate-suffix words stripped so BRK.A/BRK.B ("Berkshire Hathaway Inc.") share a dedupe key. */
const STOP_WORDS = new Set(["a", "b", "c", "class", "series", "inc", "corp", "corporation", "co", "ltd", "plc", "sa", "holdings", "the"]);
export function normalizeCompany(title: string): string {
  const words = title
    .replace(/\s*earnings\s*\([^)]*\)\s*$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const base = [...words];
  while (base.length && STOP_WORDS.has(base.at(-1)!)) base.pop();
  return (base.length ? base : words).join(" ");
}

/** Score and bucket catalysts for a ranked default view. Pure. */
export function rankCatalysts(cats: Catalyst[], opts: { asOf: string; all?: boolean; watchlist?: string[]; impliedMove?: Record<string, number> }): RankedCatalyst[] {
  const watch = new Set((opts.watchlist ?? FOCUS_WATCHLIST).map((s) => s.toUpperCase()));
  const ranked = cats
    .filter((c) => {
      if (opts.all) return true;
      // Default view: score-gated upcoming events.
      if (c.status === "lead" || c.status === "cancelled" || c.status === "done") return false;
      if (Date.parse(c.dateEnd) < Date.parse(opts.asOf)) return false;
      return scoreEvent(c) >= DEFAULT_VIEW_MIN_SCORE;
    })
    .map((c) => {
      const bucket = leadBucket(c.dateStart, opts.asOf);
      const focus = (c.ticker !== null && watch.has(c.ticker)) || c.affectedTickers.some((t) => watch.has(t));
      const im = c.kind === "earnings" ? opts.impliedMove?.[c.ticker ?? ""] : undefined;
      // Lead-time multiplier removed (badges dropped as unverifiable).
      let score = scoreEvent(c);
      if (focus) score *= 2;
      if (im != null) score *= Math.min(3, Math.max(0.5, im / 0.05));
      return {
        ...c,
        score,
        importance: importanceOf(c),
        eventClass: classifyEvent(c),
        bucket,
        ...(focus ? { focus: true } : {}),
        ...(im != null ? { impliedMove: im } : {}),
      };
    });
  // Class shares (BRK.A/BRK.B, FOXA/FOX, NWSA/NWS...) collapse to one earnings row per date+company, keeping the higher score (ties: alphabetically last ticker).
  const best = new Map<string, RankedCatalyst>();
  for (const r of ranked) {
    if (r.kind !== "earnings") continue;
    const key = `${r.dateStart}|${normalizeCompany(r.title)}`;
    const cur = best.get(key);
    if (!cur || r.score > cur.score || (r.score === cur.score && (r.ticker ?? "") > (cur.ticker ?? ""))) best.set(key, r);
  }
  const kindRank = (k: Catalyst["kind"]) => (k === "macro" ? 0 : k === "election" ? 1 : 2);
  return ranked
    .filter((r) => r.kind !== "earnings" || best.get(`${r.dateStart}|${normalizeCompany(r.title)}`) === r)
    .sort(
    (a, b) =>
      b.score - a.score ||
      kindRank(a.kind) - kindRank(b.kind) ||
      Date.parse(a.dateStart) - Date.parse(b.dateStart) ||
      a.id.localeCompare(b.id),
  );
}
