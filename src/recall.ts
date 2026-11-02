// Recall gate for the Federal Register sync: measures how many labeled-relevant docs
// the sync queries (FR_AGENCIES Rule/Proposed Rule/Notice + the all-agencies
// PRESDOCU query) + topic filter actually admit. Pure, no I/O — see scripts/recall.ts.
// fr-blind-1 is now a REGRESSION set (topic fixes in test/topics-regression.test.ts were
// informed by it), not a blind holdout.
// fr-blind-2 (test/fixtures/fr-blind-2.json, seed-7 draw) is ALSO a REGRESSION set, not a
// blind holdout, since it may have informed topic tuning.
import { FR_AGENCIES, horizonEnd } from "./catalysts/federal-register.js";
import { classify, proceduralReason, type FrApiDoc } from "./catalysts/fr-classify.js";
import { rankCatalysts } from "./catalysts/ranked.js";
import type { Catalyst } from "./types.js";
import { isNoise, isRelevant, topicTags } from "./topics.js";

export interface FrBlindRow {
  document_number: string;
  title: string;
  abstract: string | null;
  type: string;
  agency: string;
  publication_date: string;
  relevant: boolean;
  borderline: boolean;
  reason: string;
  effective_on?: string | null;
  comments_close_on?: string | null;
  dates?: string | null;
}

/** FR_AGENCIES labels, keyed by slug. */
const FR_LABELS = new Set(Object.values(FR_AGENCIES).map((a) => a.label));

/** Federal Register display name -> FR_AGENCIES label. */
const DISPLAY_TO_LABEL: Record<string, string> = {
  "Industry and Security Bureau": "BIS",
  "Trade Representative, Office of United States": "USTR",
  "Federal Trade Commission": "FTC",
  "Federal Communications Commission": "FCC",
  "International Trade Administration": "ITA",
  "U.S. Customs and Border Protection": "CBP",
  "Securities and Exchange Commission": "SEC",
};

export function rowIsFetched(row: FrBlindRow): boolean {
  // Presidential docs come from the standalone PRESDOCU query, no agency needed.
  if (row.type === "Presidential Document") return true;
  return row.agency.split(";").some((name) => {
    const label = DISPLAY_TO_LABEL[name.trim()];
    if (!label || !FR_LABELS.has(label)) return false;
    return row.type === "Rule" || row.type === "Proposed Rule" || row.type === "Notice";
  });
}

export interface RecallCounts {
  tp: number;
  fn: number;
  fp: number;
  tn: number;
  recall: number;
  precision: number;
  fnRows: FrBlindRow[];
  fpRows: FrBlindRow[];
  dvTp: number;
  dvFp: number;
  dvPrecision: number;
  dvFpRows: FrBlindRow[];
}

export interface FrRecall {
  fetched: RecallCounts;
  notFetched: RecallCounts;
  borderline: { fetched: boolean; predicted: boolean; labeledRelevant: boolean; title: string }[];
}

/** Whether a doc the sync admits would survive the default view (rank gate) as of its publication date. */
export function inDefaultView(row: FrBlindRow): boolean {
  const firstAgency = row.agency.split(";")[0]?.trim() ?? "";
  const doc: FrApiDoc = {
    title: row.title,
    abstract: row.abstract,
    type: row.type,
    document_number: row.document_number,
    agencyLabel: row.type === "Presidential Document" ? "President" : DISPLAY_TO_LABEL[firstAgency] ?? firstAgency,
    dates: row.dates ?? null,
    effective_on: row.effective_on ?? null,
    comments_close_on: row.comments_close_on ?? null,
    html_url: null,
  };
  if (isNoise(doc) || !isRelevant(doc) || proceduralReason(doc)) return false;
  const events = classify(doc, { today: row.publication_date, end: horizonEnd(row.publication_date, 180) });
  const tags = topicTags(doc);
  const cats: Catalyst[] = events.map((ev) => ({
    id: "dv",
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
    createdAt: "",
    updatedAt: "",
  }));
  return rankCatalysts(cats, { asOf: row.publication_date }).length > 0;
}

function metrics(rows: FrBlindRow[]): RecallCounts {
  let tp = 0, fn = 0, fp = 0, tn = 0, dvTp = 0, dvFp = 0;
  const fnRows: FrBlindRow[] = [];
  const fpRows: FrBlindRow[] = [];
  const dvFpRows: FrBlindRow[] = [];
  for (const row of rows) {
    const predicted = isRelevant({
      title: row.title,
      abstract: row.abstract,
      type: row.type,
      documentNumber: row.document_number,
    });
    if (predicted && inDefaultView(row)) {
      if (row.relevant) dvTp += 1;
      else { dvFp += 1; dvFpRows.push(row); }
    }
    if (row.relevant) {
      if (predicted) tp += 1;
      else { fn += 1; fnRows.push(row); }
    } else if (predicted) {
      fp += 1;
      fpRows.push(row);
    } else {
      tn += 1;
    }
  }
  return {
    tp, fn, fp, tn,
    recall: tp + fn > 0 ? tp / (tp + fn) : 0,
    precision: tp + fp > 0 ? tp / (tp + fp) : 0,
    fnRows, fpRows,
    dvTp, dvFp,
    dvPrecision: dvTp + dvFp > 0 ? dvTp / (dvTp + dvFp) : 0,
    dvFpRows,
  };
}

export function computeFrRecall(rows: FrBlindRow[]): FrRecall {
  return {
    fetched: metrics(rows.filter((r) => !r.borderline && rowIsFetched(r))),
    notFetched: metrics(rows.filter((r) => !r.borderline && !rowIsFetched(r))),
    borderline: rows
      .filter((r) => r.borderline)
      .map((r) => ({
        fetched: rowIsFetched(r),
        predicted: isRelevant({ title: r.title, abstract: r.abstract, type: r.type, documentNumber: r.document_number }),
        labeledRelevant: r.relevant,
        title: r.title,
      })),
  };
}
