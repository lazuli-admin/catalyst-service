// Deterministic structured calendars: Nasdaq earnings + primary-source macro (BLS/BEA/Fed). No LLM.
import type { Store } from "../db.js";
import type { Catalyst } from "../types.js";
import { catalystDedupeKey } from "./extract.js";
import { syncPrimaryMacro } from "./macro-primary.js";
import { syncElections, syncFederalRegister } from "./federal-register.js";
import { syncPolicyEvents } from "./policy.js";
import { errorMessage } from "../util.js";

const NASDAQ_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "application/json",
};
const TIMEOUT_MS = 15_000;

/** Market cap at or above which an earnings catalyst is tagged "megacap". */
export const MEGACAP_MIN = 200e9;

/** Per-symbol investor-relations pages; other symbols fall back to their EDGAR 8-K list. */
export const IR_SOURCES: Record<string, string> = {
  LITE: "https://investor.lumentum.com/financial-news-releases/news-details/2026/Lumentum-Announces-Reporting-Date-for-Fiscal-First-Quarter-2027-Financial-Results/default.aspx",
};

// Market-cap strings like "$253,966,172,000".
function parseMarketCap(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  const n = Number(raw.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function timeLabel(time: unknown): string {
  if (time === "time-pre-market") return "bmo";
  if (time === "time-after-hours") return "amc";
  return "time tbd";
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers: NASDAQ_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function syncCalendars(
  store: Pick<Store, "upsertCatalyst" | "purgeLegacyMacro" | "purgeStaleCatalysts" | "purgeByKeyPrefixExcept">,
  opts: { from: string; days: number; policyHorizonDays?: number; watchlist: string[]; minMarketCap: number; fetch?: typeof fetch; log?: (m: string) => void },
): Promise<{ earnings: number; macro: number }> {
  const fetchImpl = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const watch = new Set(opts.watchlist.map((s) => s.toUpperCase()));
  const counts = { earnings: 0, macro: 0 };
  await store.purgeLegacyMacro();
  try {
    for (let i = 0; i < opts.days; i++) {
      const date = new Date(Date.parse(`${opts.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) continue; // Sat/Sun
      await syncEarningsDay(store, date, { fetchImpl, watch, minMarketCap: opts.minMarketCap, log, counts });
    }
  } catch (err) {
    log(`calendars failed: ${errorMessage(err)}`);
  }
  counts.macro = await syncPrimaryMacro(store, { today: opts.from, horizonDays: opts.days, fetch: fetchImpl, log });
  // Policy horizon is longer than the earnings/macro horizon: proclamations and trials land months out.
  const policyHorizon = opts.policyHorizonDays ?? 180;
  await syncFederalRegister(store, { today: opts.from, horizonDays: policyHorizon, fetch: fetchImpl, log });
  await syncPolicyEvents(store, { today: opts.from, horizonDays: policyHorizon, log });
  await syncElections(store, { today: opts.from, horizonDays: opts.days });
  return counts;
}

async function syncEarningsDay(
  store: Pick<Store, "upsertCatalyst">,
  date: string,
  ctx: { fetchImpl: typeof fetch; watch: Set<string>; minMarketCap: number; log: (m: string) => void; counts: { earnings: number; macro: number } },
): Promise<void> {
  try {
    const body = (await fetchJson(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, ctx.fetchImpl)) as { data?: { rows?: unknown } | null };
    const rows = (body.data?.rows ?? null) as { symbol?: unknown; name?: unknown; marketCap?: unknown; time?: unknown }[] | null;
    for (const row of rows ?? []) {
      const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : null;
      const name = typeof row.name === "string" ? row.name : null;
      if (!symbol || !name) continue;
      const marketCap = parseMarketCap(row.marketCap);
      if (!ctx.watch.has(symbol) && marketCap < ctx.minMarketCap) continue;
      await upsert(store, {
        ticker: symbol,
        title: `${name} earnings (${timeLabel(row.time)})`,
        kind: "earnings",
        status: "confirmed",
        dateStart: date,
        dateEnd: date,
        confidence: 0.95,
        themes: marketCap >= MEGACAP_MIN ? ["megacap"] : [],
        affectedTickers: [],
        sourceUrl: IR_SOURCES[symbol] ?? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${symbol}&type=8-K`,
      });
      ctx.counts.earnings++;
    }
  } catch (err) {
    ctx.log(`earnings calendar ${date} failed: ${errorMessage(err)}`);
  }
}

async function upsert(store: Pick<Store, "upsertCatalyst">, c: Omit<Catalyst, "id" | "createdAt" | "updatedAt" | "sourceUrl" | "observationId" | "dedupeKey" | "sourceTier" | "datePrecision" | "impactWeight"> & { sourceUrl?: string | null; observationId?: null; dedupeKey?: string }): Promise<void> {
  await store.upsertCatalyst({ ...c, sourceTier: 1, sourceUrl: c.sourceUrl ?? null, observationId: null, dedupeKey: c.dedupeKey ?? catalystDedupeKey(c) });
}
