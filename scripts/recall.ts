// Prints the Federal Register recall gate over the labeled fixtures. Usage: tsx scripts/recall.ts [path...]
import { readFileSync } from "node:fs";
import { computeFrRecall, type FrBlindRow } from "../src/recall.js";

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["test/fixtures/fr-blind-1.json", "test/fixtures/fr-blind-2.json", "test/fixtures/fr-blind-3.json"];

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function section(name: string, c: ReturnType<typeof computeFrRecall>["fetched"]) {
  console.log(`${name} (borderline excluded)`);
  console.log(`  tp=${c.tp} fn=${c.fn} fp=${c.fp} tn=${c.tn}  recall=${fmtPct(c.recall)} precision=${fmtPct(c.precision)}`);
  console.log(`  default-view: tp=${c.dvTp} fp=${c.dvFp} precision=${fmtPct(c.dvPrecision)}`);
  console.log("  FN titles:");
  for (const r of c.fnRows) console.log(`    - ${r.document_number} ${r.title}`);
  console.log("  FP titles:");
  for (const r of c.fpRows) console.log(`    + ${r.document_number} ${r.title}`);
  console.log("  default-view FP titles:");
  for (const r of c.dvFpRows) console.log(`    + ${r.document_number} ${r.title}`);
}

for (const path of files) {
  const rows = JSON.parse(readFileSync(path, "utf8")) as FrBlindRow[];
  const { fetched, notFetched, borderline } = computeFrRecall(rows);
  console.log(`\n=== ${path} (${rows.length} rows)`);
  section("FETCHED", fetched);
  console.log();
  section("NOT FETCHED", notFetched);
  console.log();
  console.log("BORDERLINE (excluded from gate)");
  for (const b of borderline) {
    console.log(`  ${b.fetched ? "fetched" : "notFetched"} predicted=${b.predicted ? "relevant" : "not-relevant"} labeled=${b.labeledRelevant ? "relevant" : "not-relevant"} — ${b.title}`);
  }
}
