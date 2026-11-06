import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proceduralReason, type FrApiDoc } from "../src/catalysts/fr-classify.js";

const fixtureDir = new URL("../test/fixtures", import.meta.url).pathname;

function toFrApiDoc(row: Record<string, unknown>): FrApiDoc {
  return {
    title: row.title as string,
    type: row.type as string,
    document_number: row.document_number as string,
    agencyLabel: "FCC",
    docket_ids: row.docket_ids as string[] | null,
    action: row.action as string | null,
    abstract: row.abstract as string | null,
    comments_close_on: row.comments_close_on as string | null,
  };
}

describe("proceduralReason", () => {
  it("real FR metadata: substantive DA notices are NOT procedural", () => {
    const rows = JSON.parse(readFileSync(join(fixtureDir, "fcc-da-notices.json"), "utf8")) as Record<string, unknown>[];
    for (const num of ["2026-21731", "2026-21321", "2026-17193", "2026-15659", "2026-15418", "2026-07381"]) {
      expect(rows.some((r) => r.document_number === num), `fixture missing ${num}`).toBe(true);
    }
    for (const row of rows) {
      expect(proceduralReason(toFrApiDoc(row)), `dropped ${row.document_number}`).toBeNull();
    }
  });

  it("FCC Notice with DA number and generic procedural title -> procedural:bureau-notice", () => {
    const doc: FrApiDoc = {
      title: "Wireline Competition Bureau Grants Extension of Reply Comment Deadline",
      type: "Notice",
      docket_ids: ["WC Docket No. 26-1", "DA 26-900"],
      action: "Notice; extension of comment period.",
      document_number: "test-1",
      agencyLabel: "FCC",
    };
    expect(proceduralReason(doc)).toBe("procedural:bureau-notice");
  });

  it("FCC Notice with DA number, Sunshine Act Meetings title (no action) -> procedural:bureau-notice", () => {
    const doc: FrApiDoc = {
      title: "Sunshine Act Meetings",
      type: "Notice",
      docket_ids: ["DA 26-901"],
      document_number: "test-2",
      agencyLabel: "FCC",
    };
    expect(proceduralReason(doc)).toBe("procedural:bureau-notice");
  });

  it("non-FCC agency with same extension doc -> null", () => {
    const base = {
      title: "Wireline Competition Bureau Grants Extension of Reply Comment Deadline",
      type: "Notice",
      docket_ids: ["WC Docket No. 26-1", "DA 26-900"],
      action: "Notice; extension of comment period.",
    };
    for (const agencyLabel of ["SEC", "FTC"]) {
      expect(proceduralReason({ ...base, document_number: "test-3", agencyLabel })).toBeNull();
    }
  });

  it("FCC Notice with Commission number, or non-Notice type -> null", () => {
    const base = {
      title: "Wireline Competition Bureau Grants Extension of Reply Comment Deadline",
      docket_ids: ["DA 26-900"],
      document_number: "test-4",
      agencyLabel: "FCC",
    };
    expect(proceduralReason({ ...base, type: "Notice", docket_ids: [...base.docket_ids, "FCC 26-51"] })).toBeNull();
    expect(proceduralReason({ ...base, type: "Proposed Rule" } as FrApiDoc)).toBeNull();
  });

  it("Notice with no docket_ids -> null", () => {
    const doc: FrApiDoc = { title: "Some Title", type: "Notice", docket_ids: null, document_number: "test-5", agencyLabel: "FCC" };
    expect(proceduralReason(doc)).toBeNull();
  });
});
