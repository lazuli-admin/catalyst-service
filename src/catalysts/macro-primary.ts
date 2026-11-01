// Deterministic primary-source macro calendar: BLS schedule file, BEA release-dates API, FOMC calendar page. No LLM.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Store } from "../db.js";
import { errorMessage } from "../util.js";

const TIMEOUT_MS = 15_000;
const BEA_URL = "https://apps.bea.gov/API/signup/release_dates.json";
const BEA_SCHEDULE_URL = "https://www.bea.gov/news/schedule";
const FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** BEA release name -> series tag used in titles and dedupe keys. */
const BEA_SERIES: Record<string, string> = {
  "Personal Income and Outlays": "PCE",
  "Gross Domestic Product": "GDP",
};

/** Scheduled release times (ET) appended to titles, per series. */
const RELEASE_TIME: Record<string, string> = {
  CPI: "8:30 ET",
  "Jobs report": "8:30 ET",
  PPI: "8:30 ET",
  JOLTS: "10:00 ET",
  PCE: "8:30 ET",
  GDP: "8:30 ET",
};

const MONTH_INDEX: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(date: string): string {
  const [, m = 1, d = 1] = date.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

function horizonEnd(today: string, horizonDays: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10);
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { "user-agent": BROWSER_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

interface MacroRow {
  date: string;
  dateEnd?: string;
  title: string;
  dedupeKey: string;
  sourceUrl: string | null;
}

/** Upsert macro rows whose start date falls in [today, today+horizonDays]. */
async function upsertWindow(store: Pick<Store, "upsertCatalyst">, opts: { today: string; horizonDays: number }, rows: MacroRow[]): Promise<number> {
  const end = horizonEnd(opts.today, opts.horizonDays);
  let count = 0;
  for (const row of rows) {
    if (row.date < opts.today || row.date > end) continue;
    await store.upsertCatalyst({
      ticker: null,
      title: row.title,
      kind: "macro",
      status: "scheduled",
      dateStart: row.date,
      dateEnd: row.dateEnd ?? row.date,
      datePrecision: "exact",
      confidence: 1,
      themes: ["macro"],
      affectedTickers: [],
      sourceTier: 1,
      sourceUrl: row.sourceUrl,
      observationId: null,
      dedupeKey: row.dedupeKey,
    });
    count++;
  }
  return count;
}

/** BLS release schedule maintained in data/bls-schedule.json (scraped from bls.gov/schedule). */
async function syncBls(store: Pick<Store, "upsertCatalyst">, opts: { today: string; horizonDays: number; blsSchedule?: string }): Promise<number> {
  const file = opts.blsSchedule ?? path.join(process.cwd(), "data", "bls-schedule.json");
  const body = JSON.parse(await readFile(file, "utf8")) as { releases?: { date: string; release: string; series: string; url: string }[] };
  return upsertWindow(
    store,
    opts,
    (body.releases ?? []).map((e) => ({
      date: e.date,
      title: `US ${e.series}: ${e.release}${RELEASE_TIME[e.series] ? ` · ${RELEASE_TIME[e.series]}` : ""}`,
      dedupeKey: `bls:${e.series}:${e.date}`,
      sourceUrl: e.url,
    })),
  );
}

/** ISO timestamp with offset -> YYYY-MM-DD in America/New_York. */
function nyDate(iso: string): string | null {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);
}

async function syncBea(store: Pick<Store, "upsertCatalyst">, opts: { today: string; horizonDays: number }, fetchImpl: typeof fetch): Promise<number> {
  const body = (await fetchJson(BEA_URL, fetchImpl)) as Record<string, { release_dates?: string[] }>;
  const rows: MacroRow[] = [];
  for (const [name, series] of Object.entries(BEA_SERIES)) {
    for (const iso of body[name]?.release_dates ?? []) {
      const date = nyDate(iso);
      if (date) rows.push({ date, title: `US ${series}: ${name} · ${RELEASE_TIME[series]}`, dedupeKey: `bea:${series}:${date}`, sourceUrl: BEA_SCHEDULE_URL });
    }
  }
  return upsertWindow(store, opts, rows);
}

/** Parse the given year's FOMC meeting section: month/day pairs like "January"+"27-28", "April/May"+"30-1", "16-17*" (SEP). */
export function parseFomcMeetings(html: string, year: number): { dateStart: string; dateEnd: string; sep: boolean }[] {
  const marker = `${year} FOMC Meetings`;
  const start = html.indexOf(marker);
  if (start === -1) return [];
  const next = html.indexOf("FOMC Meetings", start + marker.length);
  const section = html.slice(start, next === -1 ? html.length : next);
  const out: { dateStart: string; dateEnd: string; sep: boolean }[] = [];
  for (const chunk of section.split("fomc-meeting__month").slice(1)) {
    const month = /<strong>([^<]+)<\/strong>/.exec(chunk)?.[1] ?? "";
    // Real markup: text directly in the fomc-meeting__date div (no inner <p>), e.g. `...col-lg-1">8-9*</div>`.
    const days = /fomc-meeting__date[^>]*>(?:\s*<p>)?([^<]*)/.exec(chunk)?.[1] ?? "";
    const m = /^(\d+)\s*-\s*(\d+)/.exec(days.trim());
    const [m1, m2] = month.split("/").map((s) => MONTH_INDEX[s.trim()]);
    if (!m || !m1 || (month.includes("/") && !m2)) continue;
    const crossMonth = month.includes("/");
    const pad = (n: number) => String(n).padStart(2, "0");
    out.push({
      dateStart: `${year}-${pad(m1)}-${pad(Number(m[1]))}`,
      dateEnd: `${year}-${pad(crossMonth ? m2! : m1)}-${pad(Number(m[2]))}`,
      sep: days.includes("*"),
    });
  }
  return out;
}

async function syncFomc(store: Pick<Store, "upsertCatalyst">, opts: { today: string; horizonDays: number }, fetchImpl: typeof fetch): Promise<number> {
  const res = await fetchImpl(FOMC_URL, { headers: { "user-agent": BROWSER_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${FOMC_URL}`);
  const html = await res.text();
  return upsertWindow(
    store,
    opts,
    parseFomcMeetings(html, Number(opts.today.slice(0, 4))).map((mtg) => ({
      date: mtg.dateStart,
      dateEnd: mtg.dateEnd,
      title: `FOMC rate decision ${fmt(mtg.dateEnd)} (meeting ${fmt(mtg.dateStart)}–${fmt(mtg.dateEnd)})${mtg.sep ? " + SEP" : ""} · decision 2:00 PM ET`,
      dedupeKey: `fed:fomc:${mtg.dateStart}`,
      sourceUrl: FOMC_URL,
    })),
  );
}

/** Sync all three primary macro sources; each fails independently (logged, never thrown). */
export async function syncPrimaryMacro(
  store: Pick<Store, "upsertCatalyst">,
  opts: { today: string; horizonDays: number; fetch?: typeof fetch; log?: (m: string) => void; blsSchedule?: string },
): Promise<number> {
  const fetchImpl = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  let count = 0;
  for (const [name, sync] of [
    ["bls", () => syncBls(store, opts)],
    ["bea", () => syncBea(store, opts, fetchImpl)],
    ["fomc", () => syncFomc(store, opts, fetchImpl)],
  ] as const) {
    try {
      count += await sync();
    } catch (err) {
      log(`macro ${name} failed: ${errorMessage(err)}`);
    }
  }
  return count;
}
