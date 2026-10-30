// Deterministic structured calendars (Nasdaq API): scheduled earnings + macro releases. No LLM.
import type { Store } from "../db.js";
import type { Catalyst } from "../types.js";
import { catalystDedupeKey } from "./extract.js";
import { syncElections, syncFederalRegister } from "./federal-register.js";
import { errorMessage } from "../util.js";

const NASDAQ_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "application/json",
};
const TIMEOUT_MS = 15_000;

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
  store: Pick<Store, "upsertCatalyst">,
  opts: { from: string; days: number; watchlist: string[]; minMarketCap: number; fetch?: typeof fetch; log?: (m: string) => void },
): Promise<{ earnings: number; macro: number }> {
  const fetchImpl = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const watch = new Set(opts.watchlist.map((s) => s.toUpperCase()));
  const counts = { earnings: 0, macro: 0 };
  try {
    for (let i = 0; i < opts.days; i++) {
      const date = new Date(Date.parse(`${opts.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) continue; // Sat/Sun
      await syncEarningsDay(store, date, { fetchImpl, watch, minMarketCap: opts.minMarketCap, log, counts });
      await syncMacroDay(store, date, { fetchImpl, log, counts });
    }
  } catch (err) {
    log(`calendars failed: ${errorMessage(err)}`);
  }
  await syncFederalRegister(store, { today: opts.from, horizonDays: opts.days, fetch: fetchImpl, log });
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
      if (!ctx.watch.has(symbol) && parseMarketCap(row.marketCap) < ctx.minMarketCap) continue;
      await upsert(store, {
        ticker: symbol,
        title: `${name} earnings (${timeLabel(row.time)})`,
        kind: "earnings",
        status: "confirmed",
        dateStart: date,
        dateEnd: date,
        confidence: 0.95,
        themes: [],
        affectedTickers: [],
      });
      ctx.counts.earnings++;
    }
  } catch (err) {
    ctx.log(`earnings calendar ${date} failed: ${errorMessage(err)}`);
  }
}

const MACRO_RE = /\b(CPI|Consumer Price|PPI|Producer Price|Nonfarm|Payrolls|Unemployment Rate|PCE|GDP|Retail Sales|FOMC|Fed Interest Rate|Interest Rate Decision|Fed Chair|ISM Manufacturing)\b/i;

/** Sub-series collapse: regex -> canonical title so one release = one catalyst per date. */
export const MACRO_CANONICAL: [RegExp, string][] = [
  [/cpi/i, "US CPI"],
  [/pce/i, "US PCE"],
  [/gdp/i, "US GDP"],
  [/ism manufacturing/i, "US ISM Manufacturing"],
];

export function canonicalMacroTitle(eventName: string): string | null {
  for (const [re, title] of MACRO_CANONICAL) if (re.test(eventName)) return title;
  return null;
}

async function syncMacroDay(
  store: Pick<Store, "upsertCatalyst">,
  date: string,
  ctx: { fetchImpl: typeof fetch; log: (m: string) => void; counts: { earnings: number; macro: number } },
): Promise<void> {
  try {
    const body = (await fetchJson(`https://api.nasdaq.com/api/calendar/economicevents?date=${date}`, ctx.fetchImpl)) as { data?: { rows?: unknown } | null };
    const rows = (body.data?.rows ?? null) as { gmt?: unknown; country?: unknown; eventName?: unknown }[] | null;
    const seen = new Set<string>();
    for (const row of rows ?? []) {
      if (row.country !== "United States" || typeof row.eventName !== "string") continue;
      if (!MACRO_RE.test(row.eventName)) continue;
      const title = canonicalMacroTitle(row.eventName) ?? `US ${row.eventName}`;
      // one release = one catalyst: collapse sub-series and key on exact date
      const dedupeKey = `macro:${title}:${date}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      await upsert(store, {
        ticker: null,
        title,
        dedupeKey,
        kind: "macro",
        status: "confirmed",
        dateStart: date,
        dateEnd: date,
        confidence: 0.95,
        themes: ["macro"],
        affectedTickers: [],
      });
      ctx.counts.macro++;
    }
  } catch (err) {
    ctx.log(`macro calendar ${date} failed: ${errorMessage(err)}`);
  }
}

async function upsert(store: Pick<Store, "upsertCatalyst">, c: Omit<Catalyst, "id" | "createdAt" | "updatedAt" | "sourceUrl" | "observationId" | "dedupeKey" | "sourceTier" | "datePrecision" | "impactWeight"> & { sourceUrl?: null; observationId?: null; dedupeKey?: string }): Promise<void> {
  await store.upsertCatalyst({ ...c, sourceTier: 1, sourceUrl: null, observationId: null, dedupeKey: c.dedupeKey ?? catalystDedupeKey(c) });
}
