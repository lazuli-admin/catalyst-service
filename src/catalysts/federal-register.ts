// Deterministic structured catalysts: Federal Register rules (public JSON API, no key) + static elections calendar. No LLM.
import type { Store } from "../db.js";
import { errorMessage } from "../util.js";

const TIMEOUT_MS = 15_000;

/** slug -> agency label (used in catalyst titles), themes and tickers affected by its rules. */
export const FR_AGENCIES: Record<string, { label: string; themes: string[]; affectedTickers: string[] }> = {
  "industry-and-security-bureau": {
    label: "BIS",
    themes: ["semiconductor export controls"],
    affectedTickers: ["NVDA", "AMD", "AMAT", "LRCX", "KLAC", "ASML", "TSM", "MU"],
  },
  "trade-representative-office-of-united-states": { label: "USTR", themes: ["tariffs"], affectedTickers: [] },
  "federal-trade-commission": { label: "FTC", themes: ["antitrust"], affectedTickers: [] },
  "federal-communications-commission": { label: "FCC", themes: ["telecom"], affectedTickers: [] },
};

/** FCC rules outside these topics (e.g. radio license transfers) are noise. */
export const FCC_TITLE_RE = /spectrum|broadband|net neutrality|satellite|merger/i;

/** BIS rules outside these topics (e.g. silencers/mufflers export controls) are noise. */
export const SEMI_TOPIC_RE = /semiconductor|advanced comput|integrated circuit|entity list|affiliat|end-user|artificial intelligence|supercomput|foundry|\bchips?\b/i;

/** Fixed-date political events. */
export const ELECTIONS: { date: string; title: string }[] = [
  { date: "2026-11-03", title: "US midterm elections" },
];

const ELECTION_SOURCE_URL = "https://www.usa.gov/midterm-state-and-local-elections";

const MONTHS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
/** "end(s)/expire(s)/until/through/terminate(s) <Month D, YYYY>" in rule abstracts. */
const END_DATE_RE = new RegExp(
  String.raw`\b(?:end|ends|expire|expires|until|through|terminate|terminates)\s+((?:${MONTHS})\s+\d{1,2},\s*\d{4})\b`,
  "i",
);

function parseAbstractEndDate(abstract: string): string | null {
  const m = END_DATE_RE.exec(abstract);
  if (!m) return null;
  const ts = Date.parse(`${m[1]!.replace(/\s+/g, " ")} UTC`);
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : null;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 9" from YYYY-MM-DD. */
function fmtDate(date: string): string {
  const [, m = 1, d = 1] = date.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

function horizonEnd(today: string, horizonDays: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10);
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function syncFederalRegister(
  store: Pick<Store, "upsertCatalyst" | "purgeStaleCatalysts">,
  opts: { today: string; horizonDays: number; fetch?: typeof fetch; log?: (m: string) => void },
): Promise<void> {
  const fetchImpl = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const runStart = new Date().toISOString();
  let allAgenciesOk = true;
  const end = horizonEnd(opts.today, opts.horizonDays);
  const gte = new Date(Date.parse(`${opts.today}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10);
  const fields = ["title", "effective_on", "publication_date", "html_url", "abstract", "document_number"]
    .map((f) => `fields[]=${f}`)
    .join("&");
  for (const [slug, agency] of Object.entries(FR_AGENCIES)) {
    try {
      const url =
        `https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=${encodeURIComponent(slug)}` +
        `&conditions[type][]=RULE&conditions[publication_date][gte]=${gte}&per_page=100&order=newest&${fields}`;
      const body = (await fetchJson(url, fetchImpl)) as { results?: unknown[] };
      for (const row of (body.results ?? []) as Record<string, unknown>[]) {
        const title = typeof row.title === "string" ? row.title : null;
        const documentNumber = typeof row.document_number === "string" ? row.document_number : null;
        const htmlUrl = typeof row.html_url === "string" ? row.html_url : null;
        const abstract = typeof row.abstract === "string" ? row.abstract : "";
        if (!title || !documentNumber) continue;
        if (agency.label === "FCC" && !FCC_TITLE_RE.test(title)) continue;
        if (agency.label === "BIS" && !SEMI_TOPIC_RE.test(`${title} ${abstract}`)) continue;
        // Effective-date candidates keep the plain title; abstract end dates shift to the NEXT day (rule back in force).
        const inWindow = (d: string) => d >= opts.today && d <= end;
        const candidates: { date: string; isEnd: boolean }[] = [];
        if (typeof row.effective_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.effective_on) && inWindow(row.effective_on)) {
          candidates.push({ date: row.effective_on, isEnd: false });
        }
        const abstractEnd = parseAbstractEndDate(abstract);
        if (abstractEnd) {
          const next = new Date(Date.parse(`${abstractEnd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
          if (inWindow(next)) candidates.push({ date: next, isEnd: true });
        }
        const seen = new Set<string>();
        for (const { date, isEnd } of candidates) {
          if (seen.has(date)) continue;
          seen.add(date);
          const display = isEnd
            ? `${/affiliat|end-user/i.test(title) ? `${agency.label} affiliates rule` : `${agency.label}: rule`} back in force ${fmtDate(date)} (suspension ends ${fmtDate(abstractEnd!)}) — ${title}`
            : title;
          await store.upsertCatalyst({
            ticker: null,
            title: display,
            kind: "rule_effective",
            status: "scheduled",
            dateStart: date,
            dateEnd: date,
            datePrecision: "exact",
            confidence: 0.9,
            themes: agency.themes,
            affectedTickers: agency.affectedTickers,
            sourceTier: 1,
            sourceUrl: htmlUrl,
            observationId: null,
            dedupeKey: `fr:${documentNumber}:${date}`,
          });
        }
      }
    } catch (err) {
      allAgenciesOk = false;
      log(`federal register ${slug} failed: ${errorMessage(err)}`);
    }
  }
  // Only delete rows the current code would have refreshed; a partial run must not wipe fresh-looking old rows.
  if (allAgenciesOk) await store.purgeStaleCatalysts("rule_effective", opts.today, runStart, "fr:");
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
