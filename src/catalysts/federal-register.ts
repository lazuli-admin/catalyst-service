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

function horizonEnd(today: string, horizonDays: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10);
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function syncFederalRegister(
  store: Pick<Store, "upsertCatalyst">,
  opts: { today: string; horizonDays: number; fetch?: typeof fetch; log?: (m: string) => void },
): Promise<void> {
  const fetchImpl = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
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
        // Two candidate dates: the rule's effective date and any expiry/end date stated in the abstract.
        const candidates = [row.effective_on, parseAbstractEndDate(abstract)].filter(
          (d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= opts.today && d <= end,
        );
        const seen = new Set<string>();
        for (const date of candidates) {
          if (seen.has(date)) continue;
          seen.add(date);
          await store.upsertCatalyst({
            ticker: null,
            title: date === row.effective_on ? title : `${agency.label}: ends — ${title}`,
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
      log(`federal register ${slug} failed: ${errorMessage(err)}`);
    }
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
