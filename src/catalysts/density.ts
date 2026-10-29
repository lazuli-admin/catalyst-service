import type { Catalyst, CatalystKind } from "../types.js";

export const KIND_WEIGHTS: Record<CatalystKind, number> = {
  regulatory_decision: 1.0,
  approval: 1.0,
  deal_close: 0.9,
  earnings: 0.8,
  litigation: 0.8,
  rule_effective: 0.8,
  patent_expiry: 0.7,
  lockup_expiry: 0.6,
  shareholder_vote: 0.6,
  buildout_completion: 0.6,
  product_launch: 0.5,
  index_rebalance: 0.5,
  investor_event: 0.4,
  macro: 0.3,
  other: 0.3,
};

const NEAR_DAYS = 30;
const FAR_PROXIMITY = 0.3;

/** 1 within 30d of today, decaying linearly to 0.3 at the horizon. */
function proximity(dateStart: string, today: string, horizonDays: number): number {
  const days = (Date.parse(dateStart) - Date.parse(today)) / 86_400_000;
  if (days <= NEAR_DAYS) return 1;
  if (days >= horizonDays) return FAR_PROXIMITY;
  return 1 - ((1 - FAR_PROXIMITY) * (days - NEAR_DAYS)) / (horizonDays - NEAR_DAYS);
}

export interface TickerDensity {
  ticker: string;
  score: number;
  count: number;
  kinds: CatalystKind[];
  catalysts: Catalyst[];
}

/** Per-ticker catalyst density: weighted sum with a distinct-kinds cluster bonus. Pure. */
export function catalystDensity(cats: Catalyst[], opts: { today: string; horizonDays: number }): TickerDensity[] {
  const byTicker = new Map<string, { score: number; catalysts: Catalyst[]; kinds: Set<CatalystKind> }>();
  for (const c of cats) {
    if (!c.ticker) continue;
    const weight = KIND_WEIGHTS[c.kind] * c.confidence * proximity(c.dateStart, opts.today, opts.horizonDays) * (c.status === "confirmed" ? 1.2 : 1);
    // Dedupe: an affectedTicker equal to the main ticker counts only once, at full weight.
    const targets = new Map<string, number>([[c.ticker, 1]]);
    for (const t of c.affectedTickers) if (!targets.has(t)) targets.set(t, 0.5);
    for (const [ticker, share] of targets) {
      const entry = byTicker.get(ticker) ?? { score: 0, catalysts: [], kinds: new Set<CatalystKind>() };
      entry.score += weight * share;
      entry.kinds.add(c.kind);
      entry.catalysts.push(c);
      byTicker.set(ticker, entry);
    }
  }
  return [...byTicker]
    .map(([ticker, e]) => ({
      ticker,
      score: e.score * (1 + 0.25 * (e.kinds.size - 1)),
      count: e.catalysts.length,
      kinds: [...e.kinds],
      catalysts: e.catalysts,
    }))
    .sort((a, b) => b.score - a.score);
}
