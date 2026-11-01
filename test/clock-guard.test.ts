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

const PATTERNS = [
  /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
  /\(\s*now\??\.?\(\)[^)]*\)\.toISOString\(\)\.slice\(0,\s*10\)/,
  /now\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
  /new Date\(\)\.toISOString\(\)\.split\("T"\)/,
  /Date\.now\(\)\)\.toISOString\(\)\.slice\(0,\s*10\)/,
];

describe("clock guard", () => {
  it("no source file outside src/clock.ts computes today from the raw clock", () => {
    const violations: string[] = [];
    for (const f of tsFiles(srcDir)) {
      if (f.endsWith("clock.ts")) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (PATTERNS.some((re) => re.test(line))) violations.push(`${relative(process.cwd(), f)}:${i + 1}`);
      });
    }
    expect(violations).toEqual([]);
  });

  it("the guard regexes match the canonical smell", () => {
    expect(PATTERNS.some((re) => re.test("new Date().toISOString().slice(0, 10)"))).toBe(true);
  });
});
