// Recall gate for the Federal Register sync: measures how many labeled-relevant docs
// the sync queries + topic filter actually admit. Pure, no I/O — see scripts/recall.ts.
// fr-blind-1 is now a REGRESSION set (topic fixes in test/topics-regression.test.ts were
// informed by it), not a blind holdout.
// fr-blind-2 (test/fixtures/fr-blind-2.json, seed-7 draw) is ALSO a REGRESSION set, not a
// blind holdout, since it may have informed topic tuning.
import { FR_AGENCIES, NOTICE_AGENCY_LABELS } from "./catalysts/federal-register.js";
import { isRelevant } from "./topics.js";

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
  return row.agency.split(";").some((name) => {
    const label = DISPLAY_TO_LABEL[name.trim()];
    if (!label || !FR_LABELS.has(label)) return false;
    if (row.type === "Rule" || row.type === "Proposed Rule") return true;
    return row.type === "Notice" && NOTICE_AGENCY_LABELS.includes(label);
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
}

export interface FrRecall {
  fetched: RecallCounts;
  notFetched: RecallCounts;
  borderline: { fetched: boolean; predicted: boolean; labeledRelevant: boolean; title: string }[];
}

function metrics(rows: FrBlindRow[]): RecallCounts {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  const fnRows: FrBlindRow[] = [];
  const fpRows: FrBlindRow[] = [];
  for (const row of rows) {
    const predicted = isRelevant({
      title: row.title,
      abstract: row.abstract,
      type: row.type,
      documentNumber: row.document_number,
    });
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
