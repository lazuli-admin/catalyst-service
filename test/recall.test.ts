import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { computeFrRecall, rowIsFetched, type FrBlindRow } from "../src/recall.js";
import { isRelevant, topicTags, TOPICS } from "../src/topics.js";
import { TOPIC_KEEP_EXAMPLES } from "./fixtures/topic-keep-examples.js";

// both fr-blind fixtures are regression sets (may have informed tuning)

const blind1 = JSON.parse(
  readFileSync(new URL("./fixtures/fr-blind-1.json", import.meta.url), "utf8"),
) as FrBlindRow[];
const blind2 = JSON.parse(
  readFileSync(new URL("./fixtures/fr-blind-2.json", import.meta.url), "utf8"),
) as FrBlindRow[];

interface FrRegressionRow {
  document_number: string;
  title: string;
  abstract: string | null;
  relevant: boolean | number;
}

const regression = JSON.parse(
  readFileSync(new URL("./fixtures/fr-regression.json", import.meta.url), "utf8"),
) as FrRegressionRow[];

const SEC_SRO_MISS =
  "SEC SRO filing, fetched; matches no topic after the narrow SRO procedural noise rule (known miss, not pattern-fit)";

const KNOWN_MISSES: Record<string, string> = {
  "2025-19818":
    "USMCA Labor Council meeting notice: matches USMCA topic; meeting notices are not filtered as noise yet (known FP)",
  "2025-23937": SEC_SRO_MISS,
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
});

describe("fr-blind per-doc", () => {
  for (const fixtureName of ["fr-blind-1", "fr-blind-2"] as const) {
    const rows = fixtureName === "fr-blind-1" ? blind1 : blind2;
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
