import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classify, hasOperativeMarker, operativeText, parseTextDates, roleDates, type FrApiDoc } from "../src/catalysts/fr-classify.js";

const WINDOW = { today: "2026-11-01", end: "2027-05-01" };

const AGENCY_LABELS: Record<string, string> = {
  "Executive Office of the President": "President",
  "Securities and Exchange Commission": "SEC",
  "International Trade Administration": "ITA",
  "Industry and Security Bureau": "BIS",
  "Federal Communications Commission": "FCC",
};

interface FixtureDoc {
  title: string;
  type: string;
  subtype: string | null;
  abstract: string | null;
  dates: string | null;
  effective_on: string | null;
  comments_close_on: string | null;
  document_number: string;
  html_url: string | null;
  agency_names: string[];
  body_text: string | null;
}

const fixtureDocs: FixtureDoc[] = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fr-classify-docs.json"), "utf8"),
) as FixtureDoc[];

function toApiDoc(d: FixtureDoc): FrApiDoc {
  return {
    title: d.title,
    type: d.type,
    subtype: d.subtype,
    abstract: d.abstract,
    dates: d.dates,
    effective_on: d.effective_on,
    comments_close_on: d.comments_close_on,
    document_number: d.document_number,
    html_url: d.html_url,
    agencyLabel: d.agency_names[0] === "Executive Office of the President" ? "President" : AGENCY_LABELS[d.agency_names[1] ?? d.agency_names[0] ?? ""] ?? d.agency_names[0] ?? "",
    bodyText: d.body_text,
  };
}

const apiDocs = fixtureDocs.map(toApiDoc);
const doc = (dn: string): FrApiDoc => apiDocs.find((d) => d.document_number === dn)!;

describe("fr-classify fixtures", () => {
  it("2026-16400 proclamation: exactly one presidential_action on 2026-12-04", () => {
    const rows = classify(doc("2026-16400"), WINDOW);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("presidential_action");
    expect(r.date).toBe("2026-12-04");
    expect(r.datePrecision).toBe("exact");
    expect(r.dateSource).toBe("text");
    expect(r.dedupeKey).toBe("fr:2026-16400:2026-12-04");
    expect(r.title.startsWith("Proclamation in effect Dec 4")).toBe(true);
  });

  it("2026-22051 EO: no time clauses in text → no rows, and any row would be presidential_action/estimated", () => {
    const rows = classify(doc("2026-22051"), WINDOW);
    expect(rows).toHaveLength(0);
  });

  it("2026-21599 EO: no time clauses in text → no rows, and any row would be presidential_action/estimated", () => {
    const rows = classify(doc("2026-21599"), WINDOW);
    expect(rows).toHaveLength(0);
  });

  it("2026-22266 SEC SRO notice: observed [] with no rule_effective before today", () => {
    const rows = classify(doc("2026-22266"), WINDOW);
    expect(rows).toEqual([]);
  });

  it("2026-22353 ITA AD/CVD notice: observed [] with no rule_effective before today", () => {
    const rows = classify(doc("2026-22353"), WINDOW);
    expect(rows).toEqual([]);
  });

  it("2026-14942 BIS rule: one rule_effective 2026-11-20 exact/api", () => {
    const rows = classify(doc("2026-14942"), WINDOW);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("rule_effective");
    expect(r.role).toBe("effective");
    expect(r.date).toBe("2026-11-20");
    expect(r.datePrecision).toBe("exact");
    expect(r.dateSource).toBe("api");
    expect(r.dedupeKey).toBe("fr:2026-14942:2026-11-20");
    expect(r.title).toBe(doc("2026-14942").title);
  });

  it("2026-22337 FCC proposed rule: one comment_close on 2026-12-02 (replies Jan 4), no rule_effective", () => {
    const rows = classify(doc("2026-22337"), WINDOW);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("comment_close");
    expect(r.role).toBe("comment_close");
    expect(r.date).toBe("2026-12-02");
    expect(r.datePrecision).toBe("exact");
    expect(r.dateSource).toBe("api");
    expect(r.dedupeKey).toBe("fr:2026-22337:comments:2026-12-02");
    expect(r.title).toContain("FCC comments close Dec 2 (replies Jan 4)");
    expect(rows.some((x) => x.kind === "rule_effective")).toBe(false);
  });

  it("2026-21818 FCC proposed rule: one comment_close at its comments_close_on", () => {
    const rows = classify(doc("2026-21818"), WINDOW);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("comment_close");
    expect(r.date).toBe("2026-11-25");
    expect(r.dedupeKey).toBe("fr:2026-21818:comments:2026-11-25");
    expect(r.title).toContain("FCC comments close:");
  });
});

describe("fr-classify synthetic", () => {
  const base = (over: Partial<FrApiDoc>): FrApiDoc => ({
    title: "Test doc",
    type: "Rule",
    document_number: "2026-1-TEST",
    agencyLabel: "BIS",
    ...over,
  });

  it("correction doc C1-2026-1 → []", () => {
    expect(classify(base({ document_number: "C1-2026-1", effective_on: "2026-11-20" }), WINDOW)).toEqual([]);
  });

  it('suspension abstract "The suspension is set to end November 9, 2026" → rule_effective 2026-11-10 estimated text, back-in-force title', () => {
    const rows = classify(
      base({ type: "Notice", abstract: "The suspension is set to end November 9, 2026." }),
      WINDOW,
    );
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("rule_effective");
    expect(r.role).toBe("suspension_end");
    expect(r.date).toBe("2026-11-10");
    expect(r.datePrecision).toBe("estimated");
    expect(r.dateSource).toBe("text");
    expect(r.dedupeKey).toBe("fr:2026-1-TEST:2026-11-10");
    expect(r.title).toBe("BIS: rule back in force Nov 10 (suspension ends Nov 9) — Test doc");
  });

  it("back-in-force title uses the affiliates branch for affiliate rules", () => {
    const rows = classify(
      base({ type: "Notice", title: "Ban on affiliates of X Corp", abstract: "The suspension is set to end November 9, 2026." }),
      WINDOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title.startsWith("BIS affiliates rule back in force Nov 10")).toBe(true);
  });

  it('"request for comments" title is excluded from suspension parsing', () => {
    const rows = classify(
      base({ type: "Notice", title: "Request for comments on enforcement", abstract: "The suspension is set to end November 9, 2026." }),
      WINDOW,
    );
    expect(rows).toEqual([]);
  });

  it('text "through 11:59 p.m. eastern time on November 9, 2026" → 2026-11-10', () => {
    expect(parseTextDates("through 11:59 p.m. eastern time on November 9, 2026")).toEqual([
      { date: "2026-11-10", role: "effective", raw: "through 11:59 p.m. eastern time on November 9, 2026" },
    ]);
    const rows = classify(base({ type: "Notice", dates: "through 11:59 p.m. eastern time on November 9, 2026" }), WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-11-10");
    expect(rows[0]!.kind).toBe("rule_effective");
    expect(rows[0]!.datePrecision).toBe("exact");
    expect(rows[0]!.dateSource).toBe("text");
  });

  it('presidential "12:01 a.m. on" clause → in effect that day; through-11:59 clause → next day', () => {
    expect(parseTextDates("Effective 12:01 a.m. eastern daylight time on March 1, 2027.")).toEqual([
      { date: "2027-03-01", role: "effective", raw: "12:01 a.m. eastern daylight time on March 1, 2027" },
    ]);
    const rows = classify(
      base({ type: "Presidential Document", subtype: "Executive Order", bodyText: "through 11:59 p.m. eastern time on November 9, 2026" }),
      WINDOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("presidential_action");
    expect(rows[0]!.date).toBe("2026-11-10");
    expect(rows[0]!.title).toBe("Executive Order in effect Nov 10: Test doc");
  });

  it("presidential subtype fallback label when subtype missing", () => {
    const rows = classify(
      base({ type: "Presidential Document", bodyText: "12:01 a.m. eastern time on November 9, 2026" }),
      WINDOW,
    );
    expect(rows[0]!.title.startsWith("Presidential document in effect Nov 9")).toBe(true);
  });

  it("out-of-window dates are dropped", () => {
    expect(classify(base({ effective_on: "2025-01-01" }), WINDOW)).toEqual([]);
    expect(classify(base({ effective_on: "2027-06-01" }), WINDOW)).toEqual([]);
  });

  it("invalid effective_on format is ignored", () => {
    expect(classify(base({ effective_on: "20 November 2026" }), WINDOW)).toEqual([]);
  });

  it('proposed rule with effective_on == comments_close_on -> one comment_close row without "(replies"', () => {
    const rows = classify(
      base({ type: "Proposed Rule", effective_on: "2026-12-01", comments_close_on: "2026-12-01" }),
      WINDOW,
    );
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("comment_close");
    expect(r.date).toBe("2026-12-01");
    expect(r.dedupeKey).toBe("fr:2026-1-TEST:comments:2026-12-01");
    expect(r.title).not.toContain("(replies");
  });

  it('proposed rule with effective_on < comments_close_on -> initial deadline titled "(replies Dec 15)"', () => {
    const rows = classify(
      base({ type: "Proposed Rule", effective_on: "2026-12-01", comments_close_on: "2026-12-15" }),
      WINDOW,
    );
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("comment_close");
    expect(r.date).toBe("2026-12-01");
    expect(r.dedupeKey).toBe("fr:2026-1-TEST:comments:2026-12-01");
    expect(r.title).toContain("(replies Dec 15)");
  });

  it("presidential: only in-window operative dates are emitted", () => {
    const body =
      "do hereby proclaim as follows: (1) Effective on or after 12:01 a.m. eastern time on October 1, 2026, the duty applies. (2) Effective on or after 12:01 a.m. eastern time on December 1, 2026, the higher rate applies.";
    const rows = classify(base({ type: "Presidential Document", subtype: "Proclamation", bodyText: body }), WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("presidential_action");
    expect(rows[0]!.date).toBe("2026-12-01");
  });

  it("presidential: a single out-of-window operative date (past or beyond end) yields no rows", () => {
    for (const date of ["October 1, 2026", "June 1, 2027"]) {
      const body = `do hereby proclaim as follows: (1) Effective on or after 12:01 a.m. eastern time on ${date}, the duty applies.`;
      const rows = classify(base({ type: "Presidential Document", subtype: "Proclamation", bodyText: body }), WINDOW);
      expect(rows).toEqual([]);
    }
  });
});

describe("fr-classify presidential operative markers", () => {
  const presDoc = (bodyText: string): FrApiDoc => ({
    title: "Test proclamation",
    type: "Presidential Document",
    subtype: "Proclamation",
    abstract: null,
    dates: null,
    effective_on: null,
    comments_close_on: null,
    document_number: "2026-1-MARK",
    html_url: "https://example.gov/doc",
    agencyLabel: "President",
    bodyText,
  });

  it("fixture 2025-19826 (real FR metadata + raw text): one exact presidential_action on 2026-11-10", () => {
    const fixture = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fr-eo-2025-19826.json"), "utf8"),
    ) as FrApiDoc;
    expect(hasOperativeMarker(fixture)).toBe(true);
    const rows = classify(fixture, WINDOW);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("presidential_action");
    expect(r.date).toBe("2026-11-10");
    expect(r.datePrecision).toBe("exact");
    expect(r.dateSource).toBe("text");
    expect(r.dedupeKey).toBe("fr:2025-19826:2026-11-10");
  });

  // Each text has a preamble role date (2027-01-15, in window) that MUST NOT be emitted: only the
  // marker splits it off into the preamble. Exactly one marker per text.
  const cases: [string, string][] = [
    ["proclaim as follows", "The investigation found that duties became effective January 15, 2027. NOW, THEREFORE, I, the President of the United States of America, do hereby proclaim as follows: (1) Effective on or after 12:01 a.m. eastern time on December 1, 2026, the tariff applies."],
    ["hereby ordered", "The policy is effective January 15, 2027. By the authority vested in me as President, it is hereby ordered as follows: (a) Effective December 1, 2026, the measures apply."],
    ["I hereby direct", "The report is effective January 15, 2027. By virtue of my office, I hereby direct the Secretary of Commerce to apply the duties effective December 1, 2026."],
    ["Sec. 1.", "The framework is effective January 15, 2027. Sec. 1. Policy. Effective December 1, 2026, the restrictions apply."],
    ["Section 1.", "The framework is effective January 15, 2027. Section 1. Policy. Effective December 1, 2026, the restrictions apply."],
  ];
  for (const [markerLabel, body] of cases) {
    it(`marker "${markerLabel}" opens the operative part: exact 2026-12-01, preamble date ignored`, () => {
      const d = presDoc(body);
      expect(hasOperativeMarker(d)).toBe(true);
      const rows = classify(d, WINDOW);
      expect(rows).toHaveLength(1);
      const r = rows[0]!;
      expect(r.kind).toBe("presidential_action");
      expect(r.date).toBe("2026-12-01");
      expect(r.datePrecision).toBe("exact");
      expect(r.dateSource).toBe("text");
    });
  }

  it("presidential doc without any marker: hasOperativeMarker false and rows estimated", () => {
    const d = presDoc("The duties shall apply 12:01 a.m. eastern time on November 9, 2026.");
    expect(hasOperativeMarker(d)).toBe(false);
    const rows = classify(d, WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-11-09");
    expect(rows[0]!.datePrecision).toBe("estimated");
  });
});

// Deterministic LCG so property runs are reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_383) >>> 0;
    return s / 2 ** 32;
  };
}

function syntheticDocs(rand: () => number): FrApiDoc[] {
  const types = ["Rule", "Proposed Rule", "Notice", "Presidential Document"];
  const subtypes = [null, "Proclamation", "Executive Order", "Memorandum", "Determination"];
  const iso = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const randIso = (): string => iso(2026 + Math.floor(rand() * 2), 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 28));
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const mdY = (isoDate: string): string => {
    const [y, m, d] = isoDate.split("-").map(Number);
    return `${monthNames[m! - 1]} ${d}, ${y}`;
  };
  const texts = [
    (x: string) => `Effective 12:01 a.m. eastern time on ${mdY(x)}.`,
    (x: string) => `The change applies through 11:59 p.m. eastern daylight time on ${mdY(x)}.`,
    (x: string) => `The suspension is set to expire ${mdY(x)}.`,
    (x: string) => `proceeds until ${mdY(x)} under the waiver.`,
    null,
  ];
  const docs: FrApiDoc[] = [];
  for (let i = 0; i < 50; i++) {
    const type = types[Math.floor(rand() * types.length)]!;
    const presidential = type === "Presidential Document";
    const eff = rand() < 0.5 ? randIso() : null;
    const close = rand() < 0.5 ? randIso() : null;
    const textFn = texts[Math.floor(rand() * texts.length)];
    const textDate = randIso();
    const text = textFn ? textFn(textDate) : null;
    docs.push({
      title: `Synthetic doc ${i}`,
      type,
      subtype: presidential ? subtypes[1 + Math.floor(rand() * (subtypes.length - 1))]! : null,
      abstract: presidential ? null : text,
      dates: text,
      effective_on: eff,
      comments_close_on: close,
      document_number: `2026-${10000 + i}`,
      html_url: "https://example.gov/doc",
      agencyLabel: "X",
      bodyText: presidential ? text : null,
    });
  }
  return docs;
}

describe("fr-classify properties", () => {
  const all = [...apiDocs, ...syntheticDocs(lcg(42))];

  it("proposed rules never emit rule_effective", () => {
    for (const d of all) {
      if (d.type !== "Proposed Rule") continue;
      const rows = classify(d, WINDOW);
      for (const r of rows) expect(r.kind).not.toBe("rule_effective");
    }
  });

  it("api rows exact; text rows exact only with a single unambiguous operative date", () => {
    for (const d of all) {
      const { operative } = operativeText(d);
      const opCands = roleDates(operative).filter((p) => p.date >= WINDOW.today && p.date <= WINDOW.end);
      const textExact = opCands.length > 0 && new Set(opCands.map((p) => p.date)).size === 1 && !opCands.some((p) => p.vague);
      for (const r of classify(d, WINDOW)) {
        if (r.dateSource === "api") expect(r.datePrecision).toBe("exact");
        else expect(r.datePrecision).toBe(textExact ? "exact" : "estimated");
      }
    }
  });

  it("every emitted date is effective_on/comments_close_on, a text date, or a text date + 1 day", () => {
    const iso = (s: string): string => new Date(Date.parse(`${s}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
    const months = "January|February|March|April|May|June|July|August|September|October|November|December";
    const monthDateRe = new RegExp(`\\b((${months})\\s+\\d{1,2},\\s*\\d{4})\\b`, "g");
    for (const d of all) {
      const text = [d.dates, d.abstract, d.bodyText].filter((s): s is string => typeof s === "string").join(" ");
      const textDates = [...text.matchAll(monthDateRe)].map((m) =>
        new Date(Date.parse(`${m[1]!.replace(/\s+/g, " ")} UTC`)).toISOString().slice(0, 10), // clock-guard: pure-date
      );
      const allowed = new Set(
        [d.effective_on, d.comments_close_on, ...textDates, ...textDates.map(iso)].filter((s): s is string => typeof s === "string"),
      );
      for (const r of classify(d, WINDOW)) expect(allowed.has(r.date)).toBe(true);
    }
  });

  it("output does not depend on agencyLabel except in titles", () => {
    for (const d of all) {
      const a = classify(d, WINDOW);
      const b = classify({ ...d, agencyLabel: "ZZZ Other" }, WINDOW);
      expect(b.map((r) => [r.dedupeKey, r.date, r.kind])).toEqual(a.map((r) => [r.dedupeKey, r.date, r.kind]));
    }
  });
});

describe("fr-classify date precision", () => {
  const precisionDocs = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fr-precision-docs.json"), "utf8"),
  ) as Record<string, FrApiDoc>;
  const pd = (dn: string): FrApiDoc => precisionDocs[dn]!;
  const wideWindow = { today: "2026-08-20", end: "2027-05-01" };

  it("2025-19846: stayed until Nov 9, 2026 → one exact suspension_end row, back in force Nov 10", () => {
    const rows = classify(pd("2025-19846"), WINDOW);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("rule_effective");
    expect(r.role).toBe("suspension_end");
    expect(r.date).toBe("2026-11-10");
    expect(r.datePrecision).toBe("exact");
    expect(r.dateSource).toBe("text");
  });

  it("2025-19873: past 12:01 suspension start never chosen; end-of-day → one exact 2026-11-10 row", () => {
    const rows = classify(pd("2025-19873"), WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-11-10");
    expect(rows[0]!.datePrecision).toBe("exact");
    expect(rows.every((r) => !r.date.startsWith("2025-"))).toBe(true);
  });

  it("2026-16400: proclamation with operative 12:01 clause → one exact presidential_action Dec 4", () => {
    const rows = classify(pd("2026-16400"), WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("presidential_action");
    expect(rows[0]!.date).toBe("2026-12-04");
    expect(rows[0]!.datePrecision).toBe("exact");
  });

  it("2026-16979: one operative date in window → exact; two in a wider window → both estimated", () => {
    const rows = classify(pd("2026-16979"), WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("presidential_action");
    expect(rows[0]!.date).toBe("2027-02-09");
    expect(rows[0]!.datePrecision).toBe("exact");

    const wide = classify(pd("2026-16979"), wideWindow);
    expect(wide.map((r) => r.date).sort()).toEqual(["2026-09-03", "2027-02-09"]);
    expect(wide.every((r) => r.datePrecision === "estimated")).toBe(true);
  });

  it("vague wording → estimated, never exact", () => {
    for (const dates of [
      // bare "effective on or about <date>" matches a role clause in src → row is vague
      "Effective on or about December 1, 2026.",
      // the vague flag also fires when "on or about" appears elsewhere in the sentence
      "On or about December 1, 2026, the rule is effective December 1, 2026.",
      "The rule takes effect within 30 days of publication, effective December 1, 2026.",
    ]) {
      const rows = classify({ ...pd("2025-19846"), document_number: "T1", type: "Rule", dates, effective_on: null, abstract: null }, WINDOW);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.date).toBe("2026-12-01");
      expect(rows[0]!.datePrecision).toBe("estimated");
    }
  });

  it("date only in the preamble of a presidential doc → estimated", () => {
    const doc: FrApiDoc = {
      ...pd("2026-16400"),
      document_number: "T2",
      bodyText: "Whereas the investigation is effective December 1, 2026. NOW, THEREFORE, I proclaim as follows: (1) The duties apply as stated.",
    };
    const rows = classify(doc, WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-12-01");
    expect(rows[0]!.datePrecision).toBe("estimated");
  });

  it("single explicit operative date → exact, with or without a clock time", () => {
    for (const clause of [
      "(1) Effective on or after 12:01 a.m. eastern time on December 1, 2026, the duty applies.",
      "(1) Effective on or after December 1, 2026, the duty applies.",
    ]) {
      const doc: FrApiDoc = { ...pd("2026-16400"), document_number: "T3", bodyText: `do hereby proclaim as follows: ${clause}` };
      const rows = classify(doc, WINDOW);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.date).toBe("2026-12-01");
      expect(rows[0]!.datePrecision).toBe("exact");
    }
  });

  it("two distinct in-window operative dates → all estimated", () => {
    const doc: FrApiDoc = {
      ...pd("2026-16400"),
      document_number: "T4",
      bodyText: "do hereby proclaim as follows: (1) Effective on or after December 1, 2026, the duty applies. (2) Effective on or after January 5, 2027, the higher rate applies.",
    };
    const rows = classify(doc, WINDOW);
    expect(rows.map((r) => r.date).sort()).toEqual(["2026-12-01", "2027-01-05"]);
    expect(rows.every((r) => r.datePrecision === "estimated")).toBe(true);
  });

  it("preamble 12:01 date is never chosen when the operative text has its own date", () => {
    const doc: FrApiDoc = {
      ...pd("2026-16400"),
      document_number: "T5",
      bodyText:
        "Whereas the investigation found that the measures began 12:01 a.m. eastern time on January 5, 2027. NOW, THEREFORE, I proclaim as follows: (1) Effective on or after December 1, 2026, the duty applies.",
    };
    const rows = classify(doc, WINDOW);
    expect(rows.map((r) => r.date)).toEqual(["2026-12-01"]);
  });

  it("a comments-through sentence in dates produces no rule_effective row", () => {
    const rows = classify({ ...pd("2025-19846"), document_number: "T6", type: "Rule", dates: "Comments must be submitted through December 1, 2026.", effective_on: null, abstract: null }, WINDOW);
    expect(rows.filter((r) => r.kind === "rule_effective")).toEqual([]);
  });

  it("fr-classify date precision: preamble dates are ignored when the operative text has any role date", () => {
    const rows = classify({
      ...pd("2025-19846"),
      document_number: "T7",
      type: "Rule",
      title: "Measures To Restrict Stockpiling of Example Products",
      dates: "This rule is effective September 22, 2026, through December 3, 2026.",
      abstract: "The President's import adjustments will be effective on December 4, 2026.",
      effective_on: "2026-09-22",
      comments_close_on: null,
      bodyText: null,
    }, WINDOW);
    expect(rows).toEqual([]);
  });
});
