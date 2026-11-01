import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

// Any line in src/ that derives a calendar date by slicing an ISO string must
// either be pure arithmetic on an already-known date (marked) or be removed.
const SMELL_PATTERNS = [
  /\.toISOString\(\s*\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/,
  /\.toJSON\(\)\s*\.\s*slice\(/,
  /\.split\(\s*'T'\s*\)\s*\[\s*0\s*\]/,
  /\.split\(\s*"T"\s*\)\s*\[\s*0\s*\]/,
];

const MARKER = "// clock-guard: pure-date";

// Every marked line must be reviewed here: adding or removing a marker
// requires updating this list, so pure-date usage stays a deliberate choice.
const ALLOWLIST = [
  "src/catalysts/macro-primary.ts:41",
  "src/catalysts/federal-register.ts:38",
  "src/catalysts/federal-register.ts:69",
  "src/catalysts/fr-classify.ts:46",
  "src/catalysts/fr-classify.ts:50",
  "src/catalysts/calendars.ts:54",
  "src/catalysts/page.ts:13",
  "src/catalysts/page.ts:20",
  "src/catalysts/page.ts:116",
  "src/catalysts/page.ts:121",
  "src/catalysts/page.ts:187",
  "src/catalysts/page.ts:188",
  "src/catalysts/policy.ts:41",
  "src/market.ts:143",
];

function scanSrc(): { path: string; line: number; text: string }[] {
  const lines: { path: string; line: number; text: string }[] = [];
  for (const f of tsFiles(srcDir)) {
    if (f.endsWith("clock.ts")) continue;
    readFileSync(f, "utf8").split("\n").forEach((text, i) => {
      lines.push({ path: relative(process.cwd(), f), line: i + 1, text });
    });
  }
  return lines;
}

const isMarked = (text: string) => text.includes(MARKER);

describe("clock guard", () => {
  it("no source file outside src/clock.ts computes today from the raw clock", () => {
    const violations = scanSrc()
      .filter((l) => !isMarked(l.text) && SMELL_PATTERNS.some((re) => re.test(l.text)))
      .map((l) => `${l.path}:${l.line}`);
    expect(violations).toEqual([]);
  });

  it("the set of marked lines matches the allowlist exactly", () => {
    const marked = scanSrc()
      .filter((l) => isMarked(l.text) && SMELL_PATTERNS.some((re) => re.test(l.text)))
      .map((l) => `${l.path}:${l.line}`)
      .sort();
    expect(marked).toEqual([...ALLOWLIST].sort());
  });

  it("the guard regexes match the canonical smells", () => {
    expect(SMELL_PATTERNS.some((re) => re.test("new Date().toISOString().slice(0, 10)"))).toBe(true);
    expect(SMELL_PATTERNS.some((re) => re.test("x.toISOString().slice( 0,10 )"))).toBe(true);
    expect(SMELL_PATTERNS.some((re) => re.test("d.toJSON().slice(0, 10)"))).toBe(true);
    expect(SMELL_PATTERNS.some((re) => re.test("d.split('T')[0]"))).toBe(true);
    expect(SMELL_PATTERNS.some((re) => re.test('d.split("T")[0]'))).toBe(true);
  });

  it("a marked line is skipped", () => {
    const marked = "new Date(t).toISOString().slice(0, 10) // clock-guard: pure-date";
    expect(SMELL_PATTERNS.some((re) => re.test(marked))).toBe(true);
    const violations = [{ path: "src/x.ts", line: 1, text: marked }]
      .filter((l) => !isMarked(l.text) && SMELL_PATTERNS.some((re) => re.test(l.text)));
    expect(violations).toEqual([]);
  });
});
