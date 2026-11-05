// Recall gate for the Federal Register sync: measures how many labeled-relevant docs
// the sync queries (FR_AGENCIES Rule/Proposed Rule/Notice + the all-agencies
// PRESDOCU query) + topic filter actually admit. Pure, no I/O — see scripts/recall.ts.
// fr-blind-1 is now a REGRESSION set (topic fixes in test/topics-regression.test.ts were
// informed by it), not a blind holdout.
// fr-blind-2 (test/fixtures/fr-blind-2.json, seed-7 draw) is ALSO a REGRESSION set, not a
// blind holdout, since it may have informed topic tuning.
import { FR_AGENCIES, horizonEnd } from "./catalysts/federal-register.js";
import { enforceTrust } from "./catalysts/credibility.js";
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
  subtype?: string | null;
  docket_ids?: string[] | null;
  action?: string | null;
  body_text?: string | null;
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

/** All FR_AGENCIES labels the sync would attach to this row's doc (empty if the doc is a
 * Presidential Document, which uses a fixed "President" label, or is not admitted by type). */
function docLabels(row: FrBlindRow): string[] {
  if (row.type === "Presidential Document") return ["President"];
  if (row.type !== "Rule" && row.type !== "Proposed Rule" && row.type !== "Notice") return [];
  const labels = row.agency.split(";")
    .map((name) => DISPLAY_TO_LABEL[name.trim()])
    .filter((label): label is string => !!label && FR_LABELS.has(label));
  const order = Object.values(FR_AGENCIES).map((a) => a.label);
  return [...new Set(labels)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function buildDocs(row: FrBlindRow): FrApiDoc[] {
  const docs: FrApiDoc[] = [];
  for (const label of docLabels(row)) {
    const doc: FrApiDoc = {
      title: row.title,
      abstract: row.abstract ?? "",
      type: row.type,
      subtype: row.subtype ?? null,
      document_number: row.document_number,
      agencyLabel: label,
      dates: row.dates ?? null,
      effective_on: row.effective_on ?? null,
      comments_close_on: row.comments_close_on ?? null,
      docket_ids: row.docket_ids ?? null,
      action: row.action ?? null,
      html_url: null,
      bodyText: row.body_text ?? null,
    };
    if (!isNoise(doc) && !proceduralReason(doc) && isRelevant(doc)) docs.push(doc);
  }
  return docs;
}

/** Whether the rank-gated default view would show this row's docs on SOME day: try several
 * as-of days around each classified event date (the event day, the next day, and 90/180
 * days earlier) and accept if any candidate day surfaces a surviving catalyst. */
export function inDefaultView(row: FrBlindRow): boolean {
  const docs = buildDocs(row);
  if (docs.length === 0) return false;
  const dates = new Set<string>();
  for (const doc of docs) {
    for (const ev of classify(doc, { today: "0000-01-01", end: "9999-12-31" })) dates.add(ev.date);
  }
  const candidates = [...dates]
    .flatMap((d) => [d, horizonEnd(d, 1), horizonEnd(d, -90), horizonEnd(d, -180)])
    .sort();
  return candidates.some((t) => atDay(docs, t));
}

function atDay(docs: FrApiDoc[], t: string): boolean {
  const byKey = new Map<string, Catalyst>();
  for (const doc of docs) {
    const tags = topicTags(doc);
    for (const ev of classify(doc, { today: t, end: horizonEnd(t, 180) })) {
      const draft: Catalyst = {
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
      };
      const cat = enforceTrust(draft);
      if (cat) byKey.set(ev.dedupeKey, cat);
    }
  }
  const rows = [...byKey.values()].filter(
    (c) => c.status !== "lead" && c.status !== "cancelled" && c.dateStart <= horizonEnd(t, 90) && c.dateEnd >= t,
  );
  return rankCatalysts(rows, { asOf: t }).length > 0;
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
