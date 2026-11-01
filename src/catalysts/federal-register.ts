// Deterministic structured catalysts: Federal Register rules (public JSON API, no key) + static elections calendar. No LLM.
import type { Store } from "../db.js";
import { errorMessage } from "../util.js";
import { isNoise, isRelevant, NOISE_PATTERNS, topicTags } from "../topics.js";
import { classify, type FrApiDoc } from "./fr-classify.js";

const TIMEOUT_MS = 15_000;

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

/** Agencies whose sync query also includes NOTICE documents (used by recall gate too). */
export const NOTICE_AGENCY_LABELS = ["USTR", "ITA", "CBP"];

/** Fixed-date political events. */
export const ELECTIONS: { date: string; title: string }[] = [
  { date: "2026-11-03", title: "US midterm elections" },
];

const ELECTION_SOURCE_URL = "https://www.usa.gov/midterm-state-and-local-elections";

function horizonEnd(today: string, horizonDays: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
}

export type FrDrop = { dedupeKey: string; title: string; reason: string };
export type FrSyncReport = { at: string; count: number; drops: FrDrop[] };
let lastFrSyncReport: FrSyncReport | null = null;
export function getLastFrSyncReport(): FrSyncReport | null {
  return lastFrSyncReport;
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function syncFederalRegister(
  store: Pick<Store, "upsertCatalyst" | "purgeStaleCatalysts" | "listStaleCatalysts">,
  opts: { today: string; horizonDays: number; fetch?: typeof fetch; log?: (m: string) => void },
): Promise<void> {
  const fetchImpl = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const runStart = new Date().toISOString();
  let allAgenciesOk = true;
  const dropReasons = new Map<string, string>();
  const end = horizonEnd(opts.today, opts.horizonDays);
  const gte = new Date(Date.parse(`${opts.today}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
  const fields = ["title", "effective_on", "publication_date", "html_url", "abstract", "document_number", "comments_close_on", "type", "dates"]
    .map((f) => `fields[]=${f}`)
    .join("&");
  for (const [slug, agency] of Object.entries(FR_AGENCIES)) {
    try {
      // RULE/PRORULE for everyone; trade agencies also surface proposed-notice documents (NOTICE).
      const typeParams = ["RULE", "PRORULE", ...(NOTICE_AGENCY_LABELS.includes(agency.label) ? ["NOTICE"] : [])]
        .map((t) => `conditions[type][]=${t}`).join("&");
      const url =
        `https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=${encodeURIComponent(slug)}` +
        `&${typeParams}&conditions[publication_date][gte]=${gte}&per_page=100&order=newest&${fields}`;
      const body = (await fetchJson(url, fetchImpl)) as { results?: unknown[] };
      for (const row of (body.results ?? []) as Record<string, unknown>[]) {
        const title = typeof row.title === "string" ? row.title : null;
        const documentNumber = typeof row.document_number === "string" ? row.document_number : null;
        const htmlUrl = typeof row.html_url === "string" ? row.html_url : null;
        const abstract = typeof row.abstract === "string" ? row.abstract : "";
        if (!title || !documentNumber) continue;
        // Relevance is decided by TOPIC, never agency; corrections are already covered by isNoise.
        const doc: FrApiDoc = {
          title,
          abstract,
          type: row.type as string,
          document_number: documentNumber,
          html_url: htmlUrl,
          agencyLabel: agency.label,
          dates: typeof row.dates === "string" ? row.dates : null,
          effective_on: typeof row.effective_on === "string" ? row.effective_on : null,
          comments_close_on: typeof row.comments_close_on === "string" ? row.comments_close_on : null,
        };
        if (isNoise(doc)) {
          dropReasons.set(documentNumber, `noise:${NOISE_PATTERNS.find((p) => p.test(title))?.source ?? "correction"}`);
          continue;
        }
        if (!isRelevant(doc)) {
          dropReasons.set(documentNumber, "no topic match");
          continue;
        }
        const events = classify(doc, { today: opts.today, end });
        if (events.length === 0) {
          dropReasons.set(documentNumber, "out of window");
          continue;
        }
        const tags = topicTags(doc);
        for (const ev of events) {
          // dateSource is not persisted: the catalysts table has no column for it.
          await store.upsertCatalyst({
            ticker: null,
            title: ev.title,
            kind: ev.kind,
            status: "scheduled",
            dateStart: ev.date,
            dateEnd: ev.date,
            datePrecision: ev.datePrecision,
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
    } catch (err) {
      allAgenciesOk = false;
      log(`federal register ${slug} failed: ${errorMessage(err)}`);
    }
  }
  // Only delete rows the current code would have refreshed; a partial run must not wipe fresh-looking old rows.
  if (allAgenciesOk) {
    const drops: FrDrop[] = [];
    const FR_KINDS = ["rule_effective", "comment_close", "presidential_action", "regulatory_decision"] as const;
    for (const kind of FR_KINDS) {
      const stale = await store.listStaleCatalysts(kind, opts.today, runStart, "fr:");
      for (const row of stale) {
        const docNumber = row.dedupeKey.split(":")[1] ?? "";
        const reason = dropReasons.get(docNumber) ?? "source missing";
        log(`federal register drop ${row.dedupeKey} (${reason}): ${row.title}`);
        drops.push({ dedupeKey: row.dedupeKey, title: row.title, reason });
      }
    }
    lastFrSyncReport = { at: new Date().toISOString(), count: drops.length, drops };
    for (const kind of FR_KINDS) await store.purgeStaleCatalysts(kind, opts.today, runStart, "fr:");
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
