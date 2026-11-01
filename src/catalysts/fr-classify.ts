// Pure classifier for Federal Register documents: ports the date/kind logic from federal-register.ts
// (API effective dates, proposed-rule comment deadlines, and role-word text clauses — operative
// text preferred, preamble fallback — covering suspension ends and presidential "in effect" dates).
// No I/O, no clock — all date math is UTC arithmetic on given strings.

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

export type DateRole =
  | "effective"
  | "comment_close"
  | "reply_comment_close"
  | "suspension_end"
  | "compliance"
  | "expiry";
export type FrEventKind = "rule_effective" | "rule_expiry" | "comment_close" | "presidential_action";

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
  vague?: boolean;
  /** Clause was a bare "until <date>" with no clock time — weaker evidence of the exact day. */
  bareUntil?: true;
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

/** Full "Month D, YYYY" date (month-only dates never match a role). */
const MONTH_FULL = `(?:${MONTHS})\\s+\\d{1,2},\\s*\\d{4}`;
const MONTH_FULL_RE = new RegExp(MONTH_FULL, "g");
/** "through/until 11:59 p.m. <date>" — in effect the NEXT day. */
const ROLE_END_OF_DAY_RE = new RegExp(String.raw`\b(?:through|until)\s+11:59\s*p\.m\. [a-z ]{0,60}?(?:on\s+)?(${MONTH_FULL})\b`, "gi");
/** "stayed until <date>", "suspended … until|through <date>" (no clock time), or "the suspension
 *  (is/will be) (set to) end(s)/expire(s)/terminate(s) <date>" — the stay covers the date, back in force the NEXT day. */
const ROLE_SUSPENSION_RE = new RegExp(String.raw`\b(?:stayed\s+until|suspended\s+.{0,120}?\b(?:until|through)|suspension\s+(?:is\s+|will\s+)?(?:set\s+to\s+)?(?:ends?|expires?|terminates?)|suspension\s+(?:shall\s+|will\s+)?remains?(?:\s+in\s+(?:effect|force|place))?\s+until)\s+(?!\d{1,2}:\d{2})(${MONTH_FULL})\b`, "gi");
/** "suspended/stayed until 12:01 a.m. <tz> on <date>" — start-of-day: the stay lifts ON the date itself. */
const ROLE_SUSPENSION_SOD_RE = new RegExp(String.raw`\b(?:suspended|stayed)\s+[^.;]{0,120}?\buntil\s+12:01\s*a\.m\. [a-z ]{0,60}?(?:on\s+)?(${MONTH_FULL})\b`, "gi");
/** Expiry clauses — the date is the FIRST DAY NOT IN FORCE. "expires [on] <date>", "effective [A,]
 *  until|through <date>", "in (effect|force) until|through <date>" cover the date itself, so the rule
 *  lapses the NEXT day — except start-of-day clauses ("expires at 12:01 a.m. … on <date>", "until
 *  12:01 a.m. … on <date>"), where the change happens at the start of the date. Bare forms never
 *  swallow clock times ("until|expires 11:59 p.m. …" stays with ROLE_END_OF_DAY_RE). */
const ROLE_EXPIRY_RE = new RegExp(
  String.raw`\b(?:(?:expires?\s+at|until|through)\s+12:01\s*a\.m\. [a-z ]{0,60}?(?:on\s+)?` +
    String.raw`|expires?\s+(?:on\s+)?(?!\s*\d{1,2}:\d{2})` +
    String.raw`|(?:effective(?:\s+on)?\s+[^.;]{0,120}?|remains?\s+(?:in\s+(?:effect|force)\s+)?|in\s+(?:effect|force)\s+)(?:until|through)\s+(?!\s*\d{1,2}:\d{2}))` +
    String.raw`(${MONTH_FULL})\b`,
  "gi",
);
/** Abstract sentences recounting prior history, not effects of this document. */
const NARRATIVE_RE = /\b(?:previous(?:ly)?|prior|earlier|former(?:ly)?|original(?:ly)?|supersed\w*|had\s+been|was\s+(?:set|scheduled)|published\s+(?:at|on|in)|issued\s+on)\b/i;
/** Sentence split shared by roleDates and abstractEffectStatements. */
const SENTENCE_SPLIT_RE = /(?<!\b[ap]\.m\.)(?<!\bSec\.)(?<!\bU\.S\.)(?<!\bNo\.)(?<=[.;])\s+/;
/** "12:01 a.m. … <date>", "effective [on] <date>", "on or after <date>", "in force <date>" — effective that day. */
const ROLE_EFFECTIVE_RE = new RegExp(String.raw`\b(?:12:01\s*a\.m\. [a-z ]{0,60}?(?:on\s+)?|effective(?:\s+on)?\s+(?:on\s+or\s+about\s+|approximately\s+)?|on\s+or\s+after\s+(?:on\s+or\s+about\s+|approximately\s+)?|in\s+force\s+(?:on\s+)?)(${MONTH_FULL})\b`, "gi");

/** Text markers that open the operative part of a presidential document (order, proclamation, section heading). */
export const PRESIDENTIAL_OPERATIVE_MARKERS: RegExp[] = [
  /proclaim\s+as\s+follows/i,
  /(?:it\s+is\s+)?hereby\s+(?:determine\s+and\s+)?order(?:ed)?\b/i,
  /\bI\s+hereby\s+direct\b/i,
  /\bI\s+hereby\s+determine\b/i,
  /\bSec\.\s+1\./i,
  /\bSection\s+1\./i,
];

/** Split a document into operative text (carries the role dates) vs preamble. Pure.
 *  Presidential: the earliest operative marker splits bodyText; `marker` reports whether one was found.
 *  Non-presidential: `dates` is the operative text and `marker` is always true. */
export function operativeText(doc: FrApiDoc): { operative: string; preamble: string; marker: boolean } {
  const abstract = doc.abstract ?? "";
  if (doc.type === "Presidential Document") {
    const body = doc.bodyText ?? "";
    let idx = -1;
    for (const re of PRESIDENTIAL_OPERATIVE_MARKERS) {
      const m = body.match(re);
      if (m && m.index !== undefined && (idx === -1 || m.index < idx)) idx = m.index;
    }
    if (idx >= 0) return { operative: body.slice(idx), preamble: `${body.slice(0, idx)} ${abstract}`, marker: true };
    return { operative: "", preamble: `${body} ${abstract}`, marker: false };
  }
  return {
    operative: doc.dates ?? "",
    preamble: [abstract, doc.bodyText].filter((s): s is string => typeof s === "string").join(" "),
    marker: true,
  };
}

/** Does the document carry operative text at all? Presidential docs need a marker; others always do. */
export function hasOperativeMarker(doc: FrApiDoc): boolean {
  if (doc.type !== "Presidential Document") return true;
  return operativeText(doc).marker;
}

/** Role-word dates ("effective X", "stayed until X", …) in prose. Pure. */
export function roleDates(text: string): TextDate[] {
  const norm = text.replace(/\s+/g, " ");
  const out: TextDate[] = [];
  // a.m./p.m. excluded so time clauses aren't split mid-sentence.
  for (const sentence of norm.split(SENTENCE_SPLIT_RE)) {
    if (/\bcomments?\b/i.test(sentence)) continue; // comment deadlines are not the doc's own effective role
    const vagueSentence = /within\s+\d+\s+days|\d+\s+days\s+(?:from|after)/i.test(sentence);
    const sent: TextDate[] = [];
    const push = (m: RegExpMatchArray, role: DateRole, date: string, bareUntil?: boolean): void => {
      const idx = m.index! + m[0].indexOf(m[1]!);
      const vague = vagueSentence || /on\s+or\s+about|approximately/i.test(sentence.slice(Math.max(0, idx - 60), idx));
      sent.push({ date, role, raw: m[0], ...(vague ? { vague: true } : {}), ...(bareUntil ? { bareUntil: true } : {}) });
    };
    const untilFlag = (m: RegExpMatchArray): boolean | undefined => (/\buntil\b/i.test(m[0]) ? true : undefined);
    for (const m of sentence.matchAll(ROLE_END_OF_DAY_RE)) {
      const base = toIso(m[1]!);
      if (base) push(m, "effective", nextDay(base));
    }
    for (const m of sentence.matchAll(ROLE_SUSPENSION_RE)) {
      const base = toIso(m[1]!);
      if (base) push(m, "suspension_end", nextDay(base), untilFlag(m));
    }
    for (const m of sentence.matchAll(ROLE_SUSPENSION_SOD_RE)) {
      const base = toIso(m[1]!);
      if (base) push(m, "suspension_end", base); // start-of-day: suspension ends ON the date
    }
    for (const m of sentence.matchAll(ROLE_EFFECTIVE_RE)) {
      const date = toIso(m[1]!);
      if (date) push(m, "effective", date);
    }
    for (const m of sentence.matchAll(ROLE_EXPIRY_RE)) {
      const base = toIso(m[1]!);
      // start-of-day clauses (12:01 a.m.) lapse the date itself; bare/until/through clauses the next day.
      if (base) push(m, "expiry", /12:01/.test(m[0]) ? base : nextDay(base), untilFlag(m) && !/12:01/.test(m[0]) ? true : undefined);
    }
    if (sent.some((p) => p.role === "suspension_end")) {
      // Suspension wording wins only on its own date: non-suspension entries dated elsewhere stay
      // (e.g. "effective X … suspended until Y … expires Z" keeps all three).
      const suspDates = new Set(sent.filter((p) => p.role === "suspension_end").map((p) => p.date));
      out.push(...sent.filter((p) => p.role === "suspension_end" || !suspDates.has(p.date)));
    } else if (/\b(?:suspended|stayed|suspension)\b/i.test(sentence)) {
      // Suspension wording with no parsed end date suppresses expiry in the same sentence.
      out.push(...sent.filter((p) => p.role !== "expiry"));
    } else {
      out.push(...sent);
    }
  }
  return out;
}

/** Abstract sentences that are statements of effect (narrative/prior-history sentences dropped). Pure. */
export function abstractEffectStatements(abstract: string): string {
  return abstract
    .replace(/\s+/g, " ")
    .split(SENTENCE_SPLIT_RE)
    .filter((s) => !NARRATIVE_RE.test(s))
    .join(" ");
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

  const { operative, preamble } = operativeText(doc);
  const opAll = roleDates(operative);
  const opCands = opAll.filter((p) => inWindow(p.date));
  const preCands = roleDates(preamble).filter((p) => inWindow(p.date));
  // Operative dates win: preamble dates are only used when the operative text has NO role dates at all
  // (in or out of window) — otherwise quoting another document's date in the abstract would leak a row.
  const cands = opAll.length > 0 ? opCands : preCands;
  // A bare "until <date>" clause alone is weak evidence: exact only when a non-bare clause
  // (operative or preamble) pins the same date.
  const corroborated = (list: TextDate[]): boolean =>
    list.every((p) => !p.bareUntil || list.some((q) => q.date === p.date && !q.bareUntil));
  // Corroboration pool: operative dates plus effect statements from the abstract only — never the
  // narrative abstract sentences, bodyText, or the presidential pre-marker body.
  const bareOk = corroborated([...opAll, ...roleDates(abstractEffectStatements(doc.abstract ?? ""))]);

  if (doc.type === "Presidential Document") {
    // Presidential: "in effect" dates come from role-word clauses in the text, not the API.
    const subtypeLabel = doc.subtype || "Presidential document";
    const exact = opCands.length > 0 && new Set(cands.map((p) => p.date)).size === 1 && !cands.some((p) => p.vague) && bareOk;
    for (const date of new Set(cands.map((p) => p.date))) {
      add({
        dedupeKey: `fr:${doc.document_number}:${date}`,
        title: `${subtypeLabel} in effect ${fmtDate(date)}: ${doc.title}`,
        kind: "presidential_action",
        role: "effective",
        date,
        datePrecision: exact ? "exact" : "estimated",
        dateSource: "text",
      });
    }
  } else {
    // Effective-date candidates keep the plain title; API rows are emitted before text rows so the dedupe keeps them.
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
    // Role-word text dates ("effective X", "suspension ends X → next day", time clauses) —
    // proposed rules never emit rule_effective. One row per distinct date.
    if (doc.type !== "Proposed Rule" && cands.length > 0) {
      const distinct = [...new Set(cands.map((p) => p.date))];
      const exact = opCands.length > 0 && distinct.length === 1 && !cands.some((p) => p.vague) && bareOk;
      for (const date of distinct) {
        const susp = cands.find((p) => p.date === date && p.role === "suspension_end");
        if (susp && /^(request for comments|applications for)/i.test(doc.title)) continue;
        const expiry = !susp && cands.some((p) => p.date === date && p.role === "expiry");
        const endIso = susp ? toIso([...susp.raw.matchAll(MONTH_FULL_RE)].pop()![0]!) : null;
        add({
          dedupeKey: `fr:${doc.document_number}:${date}`,
          title: susp
            ? `${/affiliat|end-user/i.test(doc.title) ? `${label} affiliates rule` : `${label}: rule`} back in force ${fmtDate(date)} (suspension ends ${fmtDate(endIso!)}) — ${doc.title}`
            : expiry
              ? `${label}: expires — first day not in force ${fmtDate(date)} — ${doc.title}`
              : doc.title,
          kind: expiry ? "rule_expiry" : "rule_effective",
          role: susp ? "suspension_end" : expiry ? "expiry" : "effective",
          date,
          datePrecision: exact ? "exact" : "estimated",
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
