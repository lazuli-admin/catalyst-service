import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  computeFrRecall,
  inDefaultView,
  rowIsFetched,
  type FrBlindRow,
} from "../src/recall.js";
import { isRelevant, topicTags, TOPICS } from "../src/topics.js";
import { TOPIC_KEEP_EXAMPLES } from "./fixtures/topic-keep-examples.js";

// fr-blind-1 and fr-blind-2 are regression sets (may have informed tuning);
// fr-blind-3 is held out

const blind1 = JSON.parse(
  readFileSync(new URL("./fixtures/fr-blind-1.json", import.meta.url), "utf8"),
) as FrBlindRow[];
const blind2 = JSON.parse(
  readFileSync(new URL("./fixtures/fr-blind-2.json", import.meta.url), "utf8"),
) as FrBlindRow[];
const blind3 = JSON.parse(
  readFileSync(new URL("./fixtures/fr-blind-3.json", import.meta.url), "utf8"),
) as FrBlindRow[];

interface FrRegressionRow {
  document_number: string;
  title: string;
  abstract: string | null;
  relevant: boolean | number;
  // optional: newer fixture rows carry these; older ones omit them
  subtype?: string | null;
  docket_ids?: string[] | null;
  action?: string | null;
}

const regression = JSON.parse(
  readFileSync(new URL("./fixtures/fr-regression.json", import.meta.url), "utf8"),
) as FrRegressionRow[];

const SEC_SRO_MISS =
  "SEC SRO filing, fetched; matches no topic after the narrow SRO procedural noise rule (known miss, not pattern-fit)";

const PRESIDENTIAL_KEEP_DEFAULT_MISS =
  "presidential keep-by-default: now relevant without a topic match; fixture label predates the rule (known FP)";

const KNOWN_MISSES: Record<string, string> = {
  "2025-19818":
    "USMCA Labor Council meeting notice: matches USMCA topic; meeting notices are not filtered as noise yet (known FP)",
  "2025-23937": SEC_SRO_MISS,
  // presidential documents flipped relevant by keep-by-default (no topic required, not ceremonial)
  "2026-02292": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-02248": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-02249": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-07724": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-13408": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-15357": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-18141": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-20320": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-21666": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  // fr-blind-3
  "2026-19416": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2025-23569": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-16125": PRESIDENTIAL_KEEP_DEFAULT_MISS,
  "2026-03889":
    "FCC filing-window proposal kept via radio-broadcast topic; no company or market impact (known FP)",
  "2026-20714":
    "clearing agency registration kept by design (matches clearing/registration topic) (known FP)",
  "2026-03237":
    "SRO crypto-options position-limit filing kept via crypto topic (known FP)",

  "2026-12612":
    "FTC consent order analysis to aid public comment; parties not in preset company universe (known FN)",
};

describe("fr-blind regression gates", () => {
  test("fr-blind-1 recall gate: fetched recall >= 0.8 (borderline excluded)", () => {
    const { fetched, notFetched, borderline } = computeFrRecall(blind1);
    expect(fetched.recall).toBeGreaterThanOrEqual(0.8);
    console.log(
      `not-fetched: tp=${notFetched.tp} fn=${notFetched.fn} fp=${notFetched.fp} tn=${notFetched.tn} recall=${notFetched.recall.toFixed(3)} precision=${notFetched.precision.toFixed(3)}`,
    );
    console.log(`borderline: ${borderline.length} rows (excluded from gate)`);
  });

  test("fr-blind-2 recall gate: fetched recall >= 0.8 (borderline excluded)", () => {
    const { fetched, notFetched, borderline } = computeFrRecall(blind2);
    expect(fetched.recall).toBeGreaterThanOrEqual(0.8);
    console.log(
      `not-fetched: tp=${notFetched.tp} fn=${notFetched.fn} fp=${notFetched.fp} tn=${notFetched.tn} recall=${notFetched.recall.toFixed(3)} precision=${notFetched.precision.toFixed(3)}`,
    );
    console.log(`borderline: ${borderline.length} rows (excluded from gate)`);
  });

  test("fr-blind-3 recall gate: fetched recall >= 0.8 (borderline excluded)", () => {
    const { fetched, notFetched, borderline } = computeFrRecall(blind3);
    expect(fetched.recall).toBeGreaterThanOrEqual(0.8);
    console.log(
      `not-fetched: tp=${notFetched.tp} fn=${notFetched.fn} fp=${notFetched.fp} tn=${notFetched.tn} recall=${notFetched.recall.toFixed(3)} precision=${notFetched.precision.toFixed(3)}`,
    );
    console.log(`borderline: ${borderline.length} rows (excluded from gate)`);
  });

  // Known borderline false positives in set 3: 2026-20714 (Cboe Clear clearing-agency
  // registration) and 2026-03237 (MEMX crypto option position limits); the SEC procedural
  // rule stays narrow and is intentionally not changed for them.
  test("fr-blind-3 post-#29 gate: recall and default-view precision reported separately", () => {
    const { fetched } = computeFrRecall(blind3);
    expect(fetched.recall).toBeGreaterThanOrEqual(0.92);
    expect(fetched.dvPrecision).toBeGreaterThanOrEqual(1);
    console.log(
      `default-view: tp=${fetched.dvTp} fp=${fetched.dvFp} precision=${fetched.dvPrecision.toFixed(3)}`,
    );
  });
});

describe("fr-blind per-doc", () => {
  for (const fixtureName of ["fr-blind-1", "fr-blind-2", "fr-blind-3"] as const) {
    const rows =
      fixtureName === "fr-blind-1"
        ? blind1
        : fixtureName === "fr-blind-2"
          ? blind2
          : blind3;
    const cases = rows
      .filter((row) => row.borderline === false && rowIsFetched(row))
      .map((row) => {
        const reason = KNOWN_MISSES[row.document_number];
        return {
          name: reason
            ? `${fixtureName} ${row.document_number} (KNOWN MISS: ${reason}): isRelevant NOT equal to ${row.relevant}`
            : `${fixtureName} ${row.document_number}: isRelevant === ${row.relevant}`,
          row,
          reason,
        };
      });
    test.each(cases)("$name", ({ row, reason }) => {
      const doc = {
        title: row.title,
        abstract: row.abstract,
        type: row.type,
        documentNumber: row.document_number,
        subtype: row.subtype ?? null,
        docket_ids: row.docket_ids ?? null,
        action: row.action ?? null,
      };
      const result = isRelevant(doc);
      if (reason) {
        expect(result).not.toBe(row.relevant);
      } else {
        expect(result).toBe(row.relevant);
      }
    });
  }
});

describe("fr-regression per-doc", () => {
  const cases = regression.map((row) => ({
    name: `fr-regression ${row.document_number}: isRelevant === ${Boolean(row.relevant)}`,
    row,
  }));
  test.each(cases)("$name", ({ row }) => {
    const doc = {
      title: row.title,
      abstract: row.abstract,
      documentNumber: row.document_number,
      subtype: row.subtype ?? null,
      docket_ids: row.docket_ids ?? null,
      action: row.action ?? null,
    };
    expect(isRelevant(doc)).toBe(Boolean(row.relevant));
  });
});

interface RealDocRow {
  topic: string;
  document_number: string;
  type: string;
  title: string;
  abstract: string | null;
}

const realDocs = JSON.parse(
  readFileSync(new URL("./fixtures/topic-real-docs.json", import.meta.url), "utf8"),
) as RealDocRow[];

describe("every topic matches at least one fixture doc", () => {
  const corpus: string[] = [];
  for (const rows of [blind1, blind2, regression]) {
    for (const row of rows) {
      if (row.relevant) {
        corpus.push(`${row.title} ${row.abstract ?? ""}`);
      }
    }
  }
  corpus.push(...TOPIC_KEEP_EXAMPLES);
  for (const doc of realDocs) {
    corpus.push(`${doc.title} ${doc.abstract ?? ""}`);
  }

  test.each(TOPICS)("topic $id matches at least one fixture doc", (topic) => {
    const found = corpus.some((s) => topic.patterns.some((p) => p.test(s)));
    expect(found, `Topic '${topic.id}' does not match any fixture doc or keep example`).toBe(true);
  });

  test("real FR docs back their topics", () => {
    for (const doc of realDocs) {
      const frDoc = {
        title: doc.title,
        abstract: doc.abstract,
        type: doc.type,
        documentNumber: doc.document_number,
      };
      expect(isRelevant(frDoc), doc.title).toBe(true);
      expect(topicTags(frDoc).topics, doc.title).toContain(doc.topic);
    }
  });
});

describe("inDefaultView live default-view docs", () => {
  const defaultView = JSON.parse(
    readFileSync(new URL("./fixtures/fr-default-view-3.json", import.meta.url), "utf8"),
  ) as FrBlindRow[];

  test.each(["2025-19846", "2026-00327", "2026-10398"])("%s is in default view", (docNumber) => {
    const row = defaultView.find((r) => r.document_number === docNumber);
    expect(row, `doc ${docNumber} missing from fixture`).toBeDefined();
    expect(inDefaultView(row!)).toBe(true);
  });
});

// Synthetic parity tests: the recall metric must classify rows exactly like the live sync —
// per-agency docs through the full admission chain (noise -> procedural -> OMB -> topic), so
// agency-scoped structural helpers (SEC SRO, ITA AD/CVD, FCC bureau-notice) activate.
describe("synthetic recall parity with live pipeline", () => {
  const synthRow = (over: Partial<FrBlindRow> & Pick<FrBlindRow, "title">): FrBlindRow => ({
    document_number: "synthetic",
    abstract: null,
    type: "Notice",
    agency: "Securities and Exchange Commission",
    publication_date: "2026-01-01",
    relevant: false,
    borderline: false,
    reason: "",
    ...over,
  });
  // predicted == what the sync would admit: for a relevant:true row the absence of FN, for a
  // relevant:false row the presence of FP
  const predicted = (row: FrBlindRow): boolean => {
    const m = computeFrRecall([row]).fetched;
    return row.relevant ? m.fn === 0 : m.fp === 1;
  };

  test("action-field OMB/PRA effective-date noise drops, substantive rule with same title keeps", () => {
    const base = synthRow({
      agency: "Federal Communications Commission",
      type: "Rule",
      title: "Accelerating Wireline Broadband Deployment by Removing Barriers to Infrastructure Investment",
    });
    const omb = {
      ...base,
      document_number: "syn-omb",
      action: "Final rule; announcement of effective date",
      abstract: "The Office of Management and Budget has approved the information collection requirements under the Paperwork Reduction Act.",
    };
    const substantive = { ...base, document_number: "syn-omb-ctrl", action: "Final rule." };
    expect(predicted(omb)).toBe(false);
    expect(predicted(substantive)).toBe(true);
  });

  test("agency-scoped SEC helper keeps SRO new-listing-standards timing notice; non-SEC stays noise", () => {
    const sec = synthRow({
      document_number: "syn-sec-ls",
      relevant: true,
      title: "Self-Regulatory Organizations; NYSE; Notice of Designation of a Longer Period for Commission Action on a Proposed Rule Change To Establish New Listing Standards",
      action: "Notice of designation of a longer period",
    });
    expect(predicted(sec)).toBe(true);
    const ftc = {
      ...sec,
      document_number: "syn-ftc-ls",
      relevant: false,
      agency: "Federal Trade Commission",
    };
    expect(predicted(ftc)).toBe(false);
  });

  test("ITA reinstatement of AD/CVD review keeps once agencyLabel is passed", () => {
    const ita = synthRow({
      document_number: "syn-ita",
      relevant: true,
      agency: "International Trade Administration",
      title: "Fresh Garlic From the People's Republic of China: Reinstatement of Antidumping and Countervailing Duty Administrative Reviews",
    });
    expect(predicted(ita)).toBe(true);
  });

  test("DA-only FCC bureau procedural notice drops; FCC-numbered control keeps as generic topic", () => {
    const base = synthRow({
      agency: "Federal Communications Commission",
      title: "Extension of the Reply Comment Deadline for the Broadband Deployment Proceeding",
    });
    const daOnly = { ...base, document_number: "syn-fcc-da", docket_ids: ["DA 26-902"] };
    const fccNumbered = { ...base, document_number: "syn-fcc-ctrl", docket_ids: ["FCC 26-902"] };
    expect(predicted(daOnly)).toBe(false);
    expect(predicted(fccNumbered)).toBe(true);
  });

  test("substantive FCC rule matches generic topics and is untouched by DA/procedural scoping", () => {
    const fccRule = synthRow({
      document_number: "syn-fcc-rule",
      relevant: true,
      agency: "Federal Communications Commission",
      type: "Rule",
      title: "Accelerating Wireline Broadband Deployment by Removing Barriers to Infrastructure Investment",
      action: "Final rule.",
      docket_ids: ["WC Docket No. 26-1", "DA 26-1"],
    });
    expect(predicted(fccRule)).toBe(true);
  });

  test("correction docs (C-prefixed document number) drop through shared conversion", () => {
    const corr = synthRow({
      document_number: "C1-2026-99999",
      title: "Amendments to Regulation SBSR for Shareholder Proposals",
    });
    expect(predicted(corr)).toBe(false);
  });
});
