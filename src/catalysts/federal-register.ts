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
  "international-trade-administration": { label: "ITA", themes: ["trade remedies"], affectedTickers: [] },
  "u-s-customs-and-border-protection": { label: "CBP", themes: ["customs"], affectedTickers: [] },
  "securities-and-exchange-commission": { label: "SEC", themes: ["securities rules"], affectedTickers: [] },
};

/** USTR/ITA/CBP rules outside these trade topics are noise. */
export const TRADE_RE = /tariff|dut(y|ies)|section 301|section 232|section 122|ieepa|reciprocal|exclusion|suspension|de minimis|low-value|semiconductor|critical mineral|rare earth|steel|aluminum|copper|lumber|automobile|auto parts|pharmaceutical|china|prc|export control|entity list|sanction|robotics|wind turbine|polysilicon|solar/i;

/** Routine ITA antidumping paperwork unless it's a Section 232 action. */
export const ITA_DROP_RE = /administrative review|sunset review|new shipper|scope ruling|rescission|preliminary results|final results/i;

/** SEC housekeeping/noise titles (exact leading phrases). */
export const SEC_DROP_PREFIXES = ["Self-Regulatory Organizations", "Submission for OMB Review", "Sunshine Act"];

/** FCC rules outside these topics (e.g. radio license transfers) are noise. */
export const FCC_TITLE_RE = /spectrum|broadband|net neutrality|satellite|merger/i;

/** BIS rules outside these topics (e.g. silencers/mufflers export controls) are noise. */
export const SEMI_TOPIC_RE = /semiconductor|advanced comput|integrated circuit|entity list|affiliat|end-user|artificial intelligence|supercomput|foundry|\bchips?\b/i;

/** Comment-close noise filter: drop boilerplate petitions/review lists, then per-agency topic keep-lists. */
export function keepCommentClose(agencyLabel: string, title: string): boolean {
  if (/^(petition for rulemaking|list of rules to be reviewed)/i.test(title)) return false;
  switch (agencyLabel) {
    case "USTR":
    case "BIS":
    case "CBP":
    case "FCC":
      return true;
    case "ITA":
      return /section 232/i.test(title);
    case "SEC":
      return /crypto|digital asset|proxy|14a-8|shareholder proposal|market structure|short sale|climate/i.test(title);
    case "FTC":
      return /merger|premerger|hart-scott|non-?compete/i.test(title);
    default:
      return true;
  }
}

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
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : null; // clock-guard: pure-date
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 9" from YYYY-MM-DD. */
function fmtDate(date: string): string {
  const [, m = 1, d = 1] = date.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

function horizonEnd(today: string, horizonDays: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
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
  const gte = new Date(Date.parse(`${opts.today}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
  const fields = ["title", "effective_on", "publication_date", "html_url", "abstract", "document_number", "comments_close_on", "type", "dates"]
    .map((f) => `fields[]=${f}`)
    .join("&");
  for (const [slug, agency] of Object.entries(FR_AGENCIES)) {
    try {
      // RULE/PRORULE for everyone; trade agencies also surface proposed-notice documents (NOTICE).
      const typeParams = ["RULE", "PRORULE", ...(agency.label === "USTR" || agency.label === "ITA" || agency.label === "CBP" ? ["NOTICE"] : [])]
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
        if (/^C\d-/.test(documentNumber)) continue; // correction documents are noise
        if (agency.label === "FCC" && !FCC_TITLE_RE.test(title)) continue;
        if (agency.label === "BIS" && !SEMI_TOPIC_RE.test(`${title} ${abstract}`)) continue;
        if (agency.label === "USTR" || agency.label === "ITA" || agency.label === "CBP") {
          if (!TRADE_RE.test(`${title} ${abstract}`)) continue;
          if (agency.label === "ITA" && ITA_DROP_RE.test(title) && !/section 232/i.test(title)) continue;
        }
        if (agency.label === "SEC" && SEC_DROP_PREFIXES.some((p) => title.startsWith(p))) continue;
        // Effective-date candidates keep the plain title; abstract end dates shift to the NEXT day (rule back in force).
        const inWindow = (d: string) => d >= opts.today && d <= end;
        const candidates: { date: string; isEnd: boolean }[] = [];
        // Proposed rules have no effective date; FR puts the comment deadline there.
        if (row.type !== "Proposed Rule" && typeof row.effective_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.effective_on) && inWindow(row.effective_on)) {
          candidates.push({ date: row.effective_on, isEnd: false });
        }
        const abstractEnd = /suspen|pause/i.test(abstract) && !/^(request for comments|applications for)/i.test(title)
          ? parseAbstractEndDate(abstract)
          : null;
        if (abstractEnd) {
          const next = new Date(Date.parse(`${abstractEnd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
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
        const commentsOn = typeof row.comments_close_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.comments_close_on) ? row.comments_close_on : null;
        // Proposed rule: effective_on is the initial comment deadline, comments_close_on the reply deadline.
        const proposedInitial =
          row.type === "Proposed Rule" && commentsOn !== null && typeof row.effective_on === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(row.effective_on) && row.effective_on < commentsOn
            ? row.effective_on
            : null;
        if (proposedInitial && commentsOn && inWindow(proposedInitial) && keepCommentClose(agency.label, title)) {
          await store.upsertCatalyst({
            ticker: null,
            title: `${agency.label} comments close ${fmtDate(proposedInitial)} (replies ${fmtDate(commentsOn)}): ${title}`,
            kind: "regulatory_decision",
            status: "scheduled",
            dateStart: proposedInitial,
            dateEnd: proposedInitial,
            datePrecision: "exact",
            confidence: 0.9,
            impactWeight: 1,
            themes: agency.themes,
            affectedTickers: agency.affectedTickers,
            sourceTier: 1,
            sourceUrl: htmlUrl,
            observationId: null,
            dedupeKey: `fr:${documentNumber}:comments:${proposedInitial}`,
          });
        } else if (commentsOn && inWindow(commentsOn) && keepCommentClose(agency.label, title)) {
          await store.upsertCatalyst({
            ticker: null,
            title: `${agency.label} comments close: ${title}`,
            kind: "regulatory_decision",
            status: "scheduled",
            dateStart: commentsOn,
            dateEnd: commentsOn,
            impactWeight: 1,
            datePrecision: "exact",
            confidence: 0.9,
            themes: agency.themes,
            affectedTickers: agency.affectedTickers,
            sourceTier: 1,
            sourceUrl: htmlUrl,
            observationId: null,
            dedupeKey: `fr:${documentNumber}:comments:${commentsOn}`,
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
    await store.purgeStaleCatalysts("rule_effective", opts.today, runStart, "fr:");
    await store.purgeStaleCatalysts("regulatory_decision", opts.today, runStart, "fr:");
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
