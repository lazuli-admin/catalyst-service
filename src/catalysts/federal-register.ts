// Deterministic structured catalysts: Federal Register rules (public JSON API, no key) + static elections calendar. No LLM.
import type { Store } from "../db.js";
import { errorMessage } from "../util.js";
import { isNoise, isRelevant, NOISE_PATTERNS, topicTags } from "../topics.js";
import { classify, hasOperativeMarker, type FrApiDoc, proceduralReason } from "./fr-classify.js";
import { curatedFrDocNumbers } from "./policy.js";

const TIMEOUT_MS = 15_000;
const FR_REQUEST_DELAY_MS = 250;
const MAX_FR_PAGES = 20;
/** FR API silently caps results at 10000 docs; hitting it means the query window is too broad. */
export const FR_RESULT_CAP = 10000;
/** Retry attempts for transient failures (429/5xx/network). */
export const FR_MAX_ATTEMPTS = 3;

/** slug -> agency label (used in catalyst titles). Relevance is decided by TOPIC, never agency; tickers are hand-curated, illustrative, reviewed manually (see src/topics.ts). */
export const FR_AGENCIES: Record<string, { label: string }> = {
  "industry-and-security-bureau": { label: "BIS" },
  "trade-representative-office-of-united-states": { label: "USTR" },
  "federal-trade-commission": { label: "FTC" },
  "federal-communications-commission": { label: "FCC" },
  "international-trade-administration": { label: "ITA" },
  "u-s-customs-and-border-protection": { label: "CBP" },
  "securities-and-exchange-commission": { label: "SEC" },
};

/** Every agency now queries NOTICE too; kept for the recall gate. */
export const NOTICE_AGENCY_LABELS = Object.values(FR_AGENCIES).map((a) => a.label);

/** Fixed-date political events. */
export const ELECTIONS: { date: string; title: string }[] = [
  { date: "2026-11-03", title: "US midterm elections" },
];

const ELECTION_SOURCE_URL = "https://www.usa.gov/midterm-state-and-local-elections";

export function horizonEnd(today: string, horizonDays: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
}

export type FrDrop = { dedupeKey: string; title: string; reason: string };
export type FrQueryReport = { name: string; pages: number; totalPages: number | null; docs: number; ok: boolean; error?: string };
export type FrSyncReport = { at: string; complete: boolean; count: number; presidentialDrops: number; drops: FrDrop[]; skippedCurated: string[]; noOperativeMarker: string[]; permitsMemos: string[]; queries: FrQueryReport[]; curatedError?: string };
let lastFrSyncReport: FrSyncReport | null = null;
export function getLastFrSyncReport(): FrSyncReport | null {
  return lastFrSyncReport;
}
/** Clears the remembered sync report; only for tests that need a clean slate between cases. */
export function resetFrSyncReportForTests(): void {
  lastFrSyncReport = null;
}

const FR_KINDS = ["rule_effective", "rule_expiry", "comment_close", "presidential_action", "regulatory_decision"] as const;

export async function syncFederalRegister(
  store: Pick<Store, "upsertCatalyst" | "purgeStaleCatalysts" | "listStaleCatalysts"> & Partial<Pick<Store, "getFrText" | "putFrText">>,
  opts: {
    today: string;
    horizonDays: number;
    fetch?: typeof fetch;
    log?: (m: string) => void;
    sleep?: (ms: number) => Promise<void>;
    curatedDocNumbers?: Set<string>;
    curatedDocNumbersLoader?: () => Promise<Set<string>>;
  },
): Promise<void> {
  const fetchImpl = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});
  // Fail closed: without the curated set we cannot tell duplicates from real rows, so abort before any fetch/write.
  let curatedDocNumbers: Set<string>;
  try {
    curatedDocNumbers = opts.curatedDocNumbers ?? (opts.curatedDocNumbersLoader ? await opts.curatedDocNumbersLoader() : await curatedFrDocNumbers());
  } catch (err) {
    const message = errorMessage(err);
    log(`federal register abort: curated doc numbers unavailable: ${message}`);
    lastFrSyncReport = { at: new Date().toISOString(), complete: false, count: 0, presidentialDrops: 0, drops: [], skippedCurated: [], noOperativeMarker: [], permitsMemos: [], queries: [], curatedError: message };
    return;
  }
  const runStart = new Date().toISOString();
  const dropReasons = new Map<string, string>();
  let cacheHits = 0;
  let cacheFetches = 0;
  const end = horizonEnd(opts.today, opts.horizonDays);
  const gte = new Date(Date.parse(`${opts.today}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
  const fields = [
    "title",
    "effective_on",
    "publication_date",
    "html_url",
    "abstract",
    "document_number",
    "comments_close_on",
    "type",
    "subtype",
    "raw_text_url",
    "dates",
    "docket_ids",
    "action",
  ]
    .map((f) => `fields[]=${f}`)
    .join("&");

  // Every agency queries RULE/PRORULE/NOTICE; one extra query covers all presidential documents.
  const targets: { name: string; slug: string | null; conditions: string; presidential: boolean }[] = [
    ...Object.entries(FR_AGENCIES).map(([slug, agency]) => ({
      name: agency.label,
      slug,
      conditions: `conditions[agencies][]=${encodeURIComponent(slug)}&${["RULE", "PRORULE", "NOTICE"].map((t) => `conditions[type][]=${t}`).join("&")}`,
      presidential: false,
    })),
    { name: "PRESDOCU", slug: null, conditions: "conditions[type][]=PRESDOCU", presidential: true },
  ];

  let firstRequest = true;
  // Sequential requests with a polite delay between them.
  const polite = async () => {
    if (!firstRequest) await sleep(FR_REQUEST_DELAY_MS);
    firstRequest = false;
  };
  const fetchResponse = async (url: string) => {
    await polite();
    for (let attempt = 1; attempt <= FR_MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        if (attempt < FR_MAX_ATTEMPTS) {
          await sleep(1000 * Math.pow(2, attempt - 1));
          continue;
        }
        throw err;
      }
      if (res.ok) return res;
      const status = res.status;
      if (status === 429 || status >= 500) {
        if (attempt < FR_MAX_ATTEMPTS) {
          const backoff = 1000 * Math.pow(2, attempt - 1);
          let delay = backoff;
          const retryAfter = res.headers?.get?.("retry-after");
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!Number.isNaN(seconds)) delay = Math.min(Math.max(seconds * 1000, backoff), 30_000);
          }
          await sleep(delay);
          continue;
        }
        throw new Error(`HTTP ${status}`);
      }
      throw new Error(`HTTP ${status}`);
    }
    throw new Error("unreachable");
  };
  const fetchJson = async (url: string): Promise<{ results?: unknown[]; total_pages?: number; count?: number }> =>
    (await fetchResponse(url)).json() as { results?: unknown[]; total_pages?: number; count?: number };

  const queries: FrQueryReport[] = [];
  const skippedCurated = new Set<string>();
  const noOperativeMarker = new Set<string>();
  const permitsMemos = new Set<string>();
  const presidentialDocNumbers = new Set<string>();
  for (const target of targets) {
    const q: FrQueryReport = { name: target.name, pages: 0, totalPages: null, docs: 0, ok: true };
    try {
      const mkUrl = (page: number) =>
        `https://www.federalregister.gov/api/v1/documents.json?${target.conditions}&conditions[publication_date][gte]=${gte}&per_page=1000&order=oldest&page=${page}&${fields}`;
      for (let page = 1; ; page++) {
        const body = await fetchJson(mkUrl(page));
        if (typeof body.count === "number" && body.count >= FR_RESULT_CAP) {
          q.ok = false;
          q.error = `result cap: count ${body.count} >= ${FR_RESULT_CAP}`;
          break;
        }
        if (q.totalPages === null && typeof body.total_pages === "number") q.totalPages = body.total_pages;
        const results = (body.results ?? []) as Record<string, unknown>[];
        q.pages = page;
        q.docs += results.length;
        for (const row of results) {
          const title = typeof row.title === "string" ? row.title : null;
          const documentNumber = typeof row.document_number === "string" ? row.document_number : null;
          const htmlUrl = typeof row.html_url === "string" ? row.html_url : null;
          const abstract = typeof row.abstract === "string" ? row.abstract : "";
          if (!title || !documentNumber) continue;
          if (target.presidential) presidentialDocNumbers.add(documentNumber);
          // Curated policy rows already carry this doc (data/policy-events.json); skip to avoid double counting.
          if (curatedDocNumbers.has(documentNumber)) {
            skippedCurated.add(documentNumber);
            dropReasons.set(documentNumber, "curated duplicate");
            log(`federal register skip ${documentNumber}: cited by curated policy row`);
            continue;
          }
          // Relevance is decided by TOPIC, never agency; corrections are already covered by isNoise.
          const doc: FrApiDoc = {
            title,
            abstract,
            type: row.type as string,
            subtype: typeof row.subtype === "string" ? row.subtype : null,
            document_number: documentNumber,
            html_url: htmlUrl,
            agencyLabel: target.presidential ? "President" : target.name,
            dates: typeof row.dates === "string" ? row.dates : null,
            effective_on: typeof row.effective_on === "string" ? row.effective_on : null,
            comments_close_on: typeof row.comments_close_on === "string" ? row.comments_close_on : null,
            docket_ids: Array.isArray(row.docket_ids) ? row.docket_ids.filter((d): d is string => typeof d === "string") : null,
            action: typeof row.action === "string" ? row.action : null,
          };
          if (isNoise(doc)) {
            dropReasons.set(documentNumber, `noise:${NOISE_PATTERNS.find((p) => p.test(title))?.source ?? "correction"}`);
            continue;
          }
          if (!isRelevant(doc)) {
          const proc = proceduralReason(doc);
          if (proc) {
            dropReasons.set(documentNumber, proc);
            continue;
          }
            dropReasons.set(documentNumber, "no topic match");
            continue;
          }
          // Presidential "in effect" dates live in the raw text, not the API metadata.
          if (target.presidential) {
            const rawUrl = typeof row.raw_text_url === "string" ? row.raw_text_url : null;
            if (!rawUrl) throw new Error("missing raw_text_url");
            // FR documents are immutable once published, so cache entries never expire.
            const cached = await store.getFrText?.(documentNumber);
            if (cached) {
              doc.bodyText = cached;
              cacheHits++;
            } else {
              doc.bodyText = await (await fetchResponse(rawUrl)).text();
              cacheFetches++;
              await store.putFrText?.(documentNumber, doc.bodyText);
            }
            if (!hasOperativeMarker(doc)) {
              // Only Proclamations and Executive Orders reliably carry operative markers; memos/determinations/notices don't.
              if (doc.subtype === "Proclamation" || doc.subtype === "Executive Order") {
                log(`federal register WARNING ${documentNumber}: no presidential operative marker; dates kept estimated`);
                noOperativeMarker.add(documentNumber);
              } else {
                permitsMemos.add(documentNumber);
              }
            }
          }
          const events = classify(doc, { today: opts.today, end });
          if (events.length === 0) {
            dropReasons.set(documentNumber, "out of window");
            continue;
          }
          const tags = topicTags(doc);
          for (const ev of events) {
            await store.upsertCatalyst({
              ticker: null,
              title: ev.title,
              kind: ev.kind,
              status: "scheduled",
              dateStart: ev.date,
              dateEnd: ev.date,
              datePrecision: ev.datePrecision,
              dateSource: ev.dateSource,
              confidence: 0.9,
              themes: tags.themes,
              affectedTickers: tags.affectedTickers,
              sourceTier: 1,
              sourceUrl: ev.sourceUrl,
              observationId: null,
              dedupeKey: ev.dedupeKey,
            });
          }
        }
        if (results.length === 0) {
          // An empty page before the declared total_pages means silently missing data; flag it.
          if (q.totalPages !== null && page < q.totalPages) {
            q.ok = false;
            q.error = `empty page ${page} of ${q.totalPages}`;
          }
          break; // stop early on an empty page
        }
        if (q.totalPages !== null && page >= q.totalPages) break;
        if (page >= MAX_FR_PAGES) {
          q.ok = false;
          q.error = "page cap exceeded";
          break;
        }
      }
    } catch (err) {
      q.ok = false;
      q.error = errorMessage(err).slice(0, 200);
      log(`federal register ${target.slug ?? target.name} failed: ${q.error}`);
    }
    queries.push(q);
  }

  log(`federal register text cache: ${cacheHits} hits, ${cacheFetches} fetches`);
  // Only delete rows the current code would have refreshed; a partial run must not wipe fresh-looking old rows.
  if (queries.every((q) => q.ok)) {
    const drops: FrDrop[] = [];
    for (const kind of FR_KINDS) {
      const stale = await store.listStaleCatalysts(kind, opts.today, runStart, "fr:");
      for (const row of stale) {
        const docNumber = row.dedupeKey.split(":")[1] ?? "";
        const reason = dropReasons.get(docNumber) ?? "source missing";
        log(`federal register drop ${row.dedupeKey} (${reason}): ${row.title}`);
        drops.push({ dedupeKey: row.dedupeKey, title: row.title, reason });
      }
    }
    const presidentialDrops = drops.filter((d) => presidentialDocNumbers.has(d.dedupeKey.split(":")[1] ?? "")).length;
    lastFrSyncReport = { at: new Date().toISOString(), complete: true, count: drops.length, presidentialDrops, drops, skippedCurated: [...skippedCurated].sort(), noOperativeMarker: [...noOperativeMarker].sort(), permitsMemos: [...permitsMemos].sort(), queries };
    for (const kind of FR_KINDS) await store.purgeStaleCatalysts(kind, opts.today, runStart, "fr:");
  } else {
    lastFrSyncReport = { at: new Date().toISOString(), complete: false, count: 0, presidentialDrops: 0, drops: [], skippedCurated: [...skippedCurated].sort(), noOperativeMarker: [...noOperativeMarker].sort(), permitsMemos: [...permitsMemos].sort(), queries };
  }
}

export async function syncElections(
  store: Pick<Store, "upsertCatalyst">,
  opts: { today: string; horizonDays: number },
): Promise<void> {
  const end = horizonEnd(opts.today, opts.horizonDays);
  for (const election of ELECTIONS) {
    if (election.date < opts.today || election.date > end) continue;
    await store.upsertCatalyst({
      ticker: null,
      title: election.title,
      kind: "election",
      status: "confirmed",
      dateStart: election.date,
      dateEnd: election.date,
      datePrecision: "exact",
      confidence: 0.95,
      themes: ["policy"],
      affectedTickers: [],
      sourceTier: 1,
      sourceUrl: ELECTION_SOURCE_URL,
      observationId: null,
      dedupeKey: `election:${election.date}`,
    });
  }
}
