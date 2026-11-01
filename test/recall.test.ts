import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { computeFrRecall, type FrBlindRow } from "../src/recall.js";

const rows = JSON.parse(
  readFileSync(new URL("./fixtures/fr-blind-1.json", import.meta.url), "utf8"),
) as FrBlindRow[];

test("fr-blind-1 recall gate: fetched recall >= 0.8 (borderline excluded)", () => {
  const { fetched, notFetched, borderline } = computeFrRecall(rows);
  expect(fetched.recall).toBeGreaterThanOrEqual(0.8);
  console.log(
    `not-fetched: tp=${notFetched.tp} fn=${notFetched.fn} fp=${notFetched.fp} tn=${notFetched.tn} recall=${notFetched.recall.toFixed(3)} precision=${notFetched.precision.toFixed(3)}`,
  );
  console.log(`borderline: ${borderline.length} rows (excluded from gate)`);
});
