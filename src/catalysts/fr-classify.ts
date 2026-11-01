// Pure classifier for Federal Register documents: ports the date/kind logic from federal-register.ts
// (API effective dates, proposed-rule comment deadlines, abstract suspension ends, presidential
// "in effect" text clauses). No I/O, no clock — all date math is UTC arithmetic on given strings.

export type FrDocType = "Rule" | "Proposed Rule" | "Notice" | "Presidential Document";

export interface FrApiDoc {
  title: string;
  type: string;
  subtype?: string | null;
  abstract?: string | null;
  dates?: string | null;
  effective_on?: string | null;
  comments_close_on?: string | null;
  document_number: string;
  html_url?: string | null;
  agencyLabel: string;
  bodyText?: string | null;
}

export type DateRole = "effective" | "comment_close" | "reply_comment_close" | "suspension_end" | "compliance";
export type FrEventKind = "rule_effective" | "comment_close" | "presidential_action";

export interface CandidateEvent {
  dedupeKey: string;
  title: string;
  kind: FrEventKind;
  role: DateRole;
  date: string;
  datePrecision: "exact" | "estimated";
  dateSource: "api" | "text";
  sourceUrl: string | null;
}

const MONTHS =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
/** "end(s)/expire(s)/until/through/terminate(s) <Month D, YYYY>" in rule abstracts. */
const END_DATE_RE = new RegExp(
  String.raw`\b(?:end|ends|expire|expires|until|through|terminate|terminates)\s+((?:${MONTHS})\s+\d{1,2},\s*\d{4})\b`,
  "i",
);

const MONTH_DATE = `((?:${MONTHS})\\s+\\d{1,2},\\s*\\d{4})`;
/** "12:01 a.m. eastern [daylight] time on <Month D, YYYY>" — change takes effect that day. */
const MIDNIGHT_RE = new RegExp(String.raw`\b12:01\s*a\.m\. ([a-z ]{0,60}?)(?:on )?${MONTH_DATE}`, "i");
/** "through 11:59 p.m. eastern [daylight] time [on] <Month D, YYYY>" — in effect the NEXT day. */
const END_OF_DAY_RE = new RegExp(String.raw`\bthrough\s+11:59\s*p\.m\. ([a-z ]{0,60}?)(?:on )?${MONTH_DATE}`, "i");

function toIso(monthDayYear: string): string | null {
  const ts = Date.parse(`${monthDayYear.replace(/\s+/g, " ")} UTC`);
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : null; // clock-guard: pure-date
}

function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 9" from YYYY-MM-DD. */
export function fmtDate(date: string): string {
  const [, m = 1, d = 1] = date.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

export interface TextDate {
  date: string;
  role: DateRole;
  raw: string;
}

/** Time-clause dates ("12:01 a.m. … on <date>", "through 11:59 p.m. … <date>") in prose text.
 *  A "through 11:59 p.m." clause means the change is in effect the NEXT day. */
export function parseTextDates(text: string): TextDate[] {
  const norm = text.replace(/\s+/g, " ");
  const out: TextDate[] = [];
  for (const m of norm.matchAll(new RegExp(MIDNIGHT_RE.source, "gi"))) {
    const date = toIso(m[2]!);
    if (date) out.push({ date, role: "effective", raw: m[0].replace(/\s+/g, " ") });
  }
  for (const m of norm.matchAll(new RegExp(END_OF_DAY_RE.source, "gi"))) {
    const base = toIso(m[2]!);
    if (base) out.push({ date: nextDay(base), role: "effective", raw: m[0].replace(/\s+/g, " ") });
  }
  return out;
}

/** Classify one FR document into in-window candidate events. Pure. */
export function classify(doc: FrApiDoc, window: { today: string; end: string }): CandidateEvent[] {
  if (/^C\d-/.test(doc.document_number)) return [];
  const inWindow = (d: string) => d >= window.today && d <= window.end;
  const label = doc.agencyLabel;
  const rows: CandidateEvent[] = [];
  const add = (r: Omit<CandidateEvent, "sourceUrl">): void => {
    rows.push({ ...r, sourceUrl: doc.html_url ?? null });
  };

  if (doc.type === "Presidential Document") {
    // Presidential: "in effect" dates come from time clauses in the text, not the API.
    const text = [doc.bodyText, doc.dates, doc.abstract].filter((s): s is string => typeof s === "string").join(" ");
    const seen = new Set<string>();
    for (const p of parseTextDates(text)) {
      if (!inWindow(p.date) || seen.has(p.date)) continue;
      seen.add(p.date);
      const subtypeLabel = doc.subtype || "Presidential document";
      add({
        dedupeKey: `fr:${doc.document_number}:${p.date}`,
        title: `${subtypeLabel} in effect ${fmtDate(p.date)}: ${doc.title}`,
        kind: "presidential_action",
        role: "effective",
        date: p.date,
        datePrecision: "estimated",
        dateSource: "text",
      });
    }
  } else {
    // Effective-date candidates keep the plain title; abstract end dates shift to the NEXT day (rule back in force).
    if (doc.type !== "Proposed Rule" && typeof doc.effective_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(doc.effective_on) && inWindow(doc.effective_on)) {
      add({
        dedupeKey: `fr:${doc.document_number}:${doc.effective_on}`,
        title: doc.title,
        kind: "rule_effective",
        role: "effective",
        date: doc.effective_on,
        datePrecision: "exact",
        dateSource: "api",
      });
    }
    // Suspension end and in-force/expiry text clauses only apply to Rule/Notice: proposed rules never emit rule_effective.
    const abstract = typeof doc.abstract === "string" ? doc.abstract : "";
    if (doc.type !== "Proposed Rule" && /suspen|pause/i.test(abstract) && !/^(request for comments|applications for)/i.test(doc.title)) {
      const m = END_DATE_RE.exec(abstract);
      const endIso = m ? toIso(m[1]!) : null;
      if (endIso) {
        const next = nextDay(endIso);
        if (inWindow(next)) {
          add({
            dedupeKey: `fr:${doc.document_number}:${next}`,
            title: `${/affiliat|end-user/i.test(doc.title) ? `${label} affiliates rule` : `${label}: rule`} back in force ${fmtDate(next)} (suspension ends ${fmtDate(endIso)}) — ${doc.title}`,
            kind: "rule_effective",
            role: "suspension_end",
            date: next,
            datePrecision: "estimated",
            dateSource: "text",
          });
        }
      }
    }
    const commentsOn =
      typeof doc.comments_close_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(doc.comments_close_on) ? doc.comments_close_on : null;
    // Proposed rule: effective_on is the initial comment deadline, comments_close_on the reply deadline.
    const proposedInitial =
      doc.type === "Proposed Rule" && commentsOn !== null && typeof doc.effective_on === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(doc.effective_on) && doc.effective_on < commentsOn
        ? doc.effective_on
        : null;
    if (proposedInitial && inWindow(proposedInitial)) {
      add({
        dedupeKey: `fr:${doc.document_number}:comments:${proposedInitial}`,
        title: `${label} comments close ${fmtDate(proposedInitial)} (replies ${fmtDate(commentsOn!)}): ${doc.title}`,
        kind: "comment_close",
        role: "comment_close",
        date: proposedInitial,
        datePrecision: "exact",
        dateSource: "api",
      });
    } else if (commentsOn && inWindow(commentsOn)) {
      add({
        dedupeKey: `fr:${doc.document_number}:comments:${commentsOn}`,
        title: `${label} comments close: ${doc.title}`,
        kind: "comment_close",
        role: "comment_close",
        date: commentsOn,
        datePrecision: "exact",
        dateSource: "api",
      });
    }
    // Time-clause text dates ("12:01 a.m.", "through 11:59 p.m. → next day") from the doc text.
    if (doc.type !== "Proposed Rule") {
      const text = [doc.dates, doc.abstract, doc.bodyText].filter((s): s is string => typeof s === "string").join(" ");
      for (const p of parseTextDates(text)) {
        if (!inWindow(p.date)) continue;
        add({
          dedupeKey: `fr:${doc.document_number}:${p.date}`,
          title: doc.title,
          kind: "rule_effective",
          role: p.role,
          date: p.date,
          datePrecision: "estimated",
          dateSource: "text",
        });
      }
    }
  }

  const seen = new Set<string>();
  const out: CandidateEvent[] = [];
  for (const r of rows) {
    if (seen.has(r.dedupeKey)) continue;
    seen.add(r.dedupeKey);
    out.push(r);
  }
  return out;
}
