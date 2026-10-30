import type { Catalyst, CatalystKind, DatePrecision } from "../types.js";

/** Weight by kind tier: 3 = market-moving decisions, 2 = structural supply/index events, 1 = informational. */
export const KIND_WEIGHTS: Record<CatalystKind, 1 | 2 | 3> = {
  earnings: 3,
  regulatory_decision: 3,
  phase3_readout: 3,
  shareholder_vote: 3,
  approval: 3,
  deal_close: 3,
  litigation: 3,
  patent_decision: 3,
  rule_effective: 3,
  lockup_expiry: 2,
  index_rebalance: 2,
  buyback_offering: 2,
  patent_expiry: 2,
  buildout_completion: 2,
  investor_event: 1,
  product_launch: 1,
  conference: 1,
  peer_read_across: 1,
  macro: 1,
  election: 1,
  other: 1,
};

/** Multiplier by how precisely the date is known. */
export const PRECISION_MULTIPLIER: Record<DatePrecision, number> = { exact: 1.0, window: 0.7, estimated: 0.4 };
/** Window multiplier floor when the window itself is wider than 14 trading days. */
export const WIDE_WINDOW_MULTIPLIER = 0.4;
/** Lead-time multipliers and buckets by trading days from asOf. */
export const LEAD_MULTIPLIERS = { priced: 0.5, actionable: 1.0, watchlist: 0.6, distant: 0.3 } as const;
export type LeadBucket = keyof typeof LEAD_MULTIPLIERS;
/** Bonus per additional distinct kind in a 10-trading-day cluster. */
export const CLUSTER_BONUS_PER_KIND = 1.5;
/** Max span (trading days) for two catalysts to belong to the same cluster. */
export const CLUSTER_SPAN_DAYS = 10;

export type TickerDensityItem = {
  catalyst: Catalyst;
  /** weight * certainty * lead-time, before cluster bonus */
  score: number;
  bucket: LeadBucket;
};

export interface TickerDensity {
  ticker: string;
  score: number;
  actionableScore: number;
  clusters: { start: string; end: string; kinds: CatalystKind[] }[];
  items: TickerDensityItem[];
}

/** Approximate trading days between two YYYY-MM-DD dates (weekdays only, b exclusive if after a). */
export function tradingDaysBetween(a: string, b: string): number {
  let count = 0;
  for (let d = Date.parse(a); d < Date.parse(b); d += 86_400_000) {
    const day = new Date(d).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export function leadBucket(dateStart: string, asOf: string): LeadBucket {
  const days = tradingDaysBetween(asOf, dateStart);
  if (days < 5) return "priced";
  if (days <= 30) return "actionable";
  if (days <= 180) return "watchlist";
  return "distant";
}

export function certainty(c: Catalyst): number {
  if (c.datePrecision === "exact") return PRECISION_MULTIPLIER.exact;
  if (c.datePrecision === "window") {
    const width = tradingDaysBetween(c.dateStart, c.dateEnd);
    return width <= 10 ? PRECISION_MULTIPLIER.window : WIDE_WINDOW_MULTIPLIER;
  }
  return PRECISION_MULTIPLIER.estimated;
}

/** Per-ticker catalyst density with lead-time buckets and distinct-kind cluster bonuses. Pure. */
export function catalystDensity(
  cats: Catalyst[],
  opts: { asOf: string; ratePolicySensitive?: ReadonlySet<string> },
): TickerDensity[] {
  const sensitive = opts.ratePolicySensitive ?? new Set<string>();
  const byTicker = new Map<string, TickerDensity>();
  for (const c of cats) {
    if (c.status === "lead" || c.status === "cancelled" || c.status === "done") continue;
    // Past events no longer move prices.
    if (Date.parse(c.dateEnd) < Date.parse(opts.asOf)) continue;
    const bucket = leadBucket(c.dateStart, opts.asOf);
    const base = KIND_WEIGHTS[c.kind] * certainty(c) * LEAD_MULTIPLIERS[bucket] * c.confidence;
    // Dedupe: an affectedTicker equal to the main ticker counts only once, at full weight.
    const targets = new Map<string, number>([...(c.ticker ? [[c.ticker, 1] as const] : []), ...c.affectedTickers.map((t) => [t, 0.5] as const)]);
    for (const [ticker, share] of targets) {
      const entry = byTicker.get(ticker) ?? { ticker, score: 0, actionableScore: 0, clusters: [], items: [] };
      // Macro/election read through as 2x for rate-policy-sensitive tickers.
      const rateBoost = (c.kind === "macro" || c.kind === "election") && sensitive.has(ticker) ? 2 : 1;
      const itemScore = base * share * rateBoost;
      entry.items.push({ catalyst: c, score: itemScore, bucket });
      if (bucket === "actionable") entry.actionableScore += itemScore;
      byTicker.set(ticker, entry);
    }
  }
  for (const entry of byTicker.values()) {
    entry.items.sort((a, b) => Date.parse(a.catalyst.dateStart) - Date.parse(b.catalyst.dateStart));
    entry.score = entry.items.reduce((sum, i) => sum + i.score, 0);
    // Cluster bonus: items whose dateStart is within CLUSTER_SPAN_DAYS of the cluster's FIRST item, with >=2 distinct kinds.
    let cluster: TickerDensityItem[] = [];
    const flush = () => {
      if (cluster.length >= 2) {
        const kinds = [...new Set(cluster.map((i) => i.catalyst.kind))];
        if (kinds.length >= 2) {
          const maxLead = Math.max(...cluster.map((i) => LEAD_MULTIPLIERS[i.bucket]));
          const bonus = CLUSTER_BONUS_PER_KIND * (kinds.length - 1) * maxLead;
          entry.score += bonus;
          if (cluster.some((i) => i.bucket === "actionable")) entry.actionableScore += bonus;
          entry.clusters.push({ start: cluster[0]!.catalyst.dateStart, end: cluster.at(-1)!.catalyst.dateStart, kinds });
        }
      }
      cluster = [];
    };
    for (const item of entry.items) {
      if (cluster.length && tradingDaysBetween(cluster[0]!.catalyst.dateStart, item.catalyst.dateStart) > CLUSTER_SPAN_DAYS) flush();
      cluster.push(item);
    }
    flush();
  }
  return [...byTicker.values()].sort((a, b) => b.score - a.score);
}
