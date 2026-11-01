import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { curatedFrDocNumbers, frDocNumbersFromEvents, syncPolicyEvents } from "../src/catalysts/policy.js";
import type { Catalyst } from "../src/types.js";

describe("frDocNumbersFromEvents", () => {
  it("extracts the FR doc number from a federalregister.gov /documents/YYYY/MM/DD/<doc-number>/ URL and ignores non-FR URLs", () => {
    const events = [
      {
        sourceUrl: "https://www.federalregister.gov/documents/2026/08/11/2026-16400/adjusting-imports-of-polysilicon-and-its-derivatives-into-the-united-states",
      },
      { sourceUrl: "https://www.whitehouse.gov/presidential-actions/2026/08/adjusting-imports-of-polysilicon/" },
      { sourceUrl: "https://ustr.gov/issues/china" },
    ];
    expect(frDocNumbersFromEvents(events)).toEqual(new Set(["2026-16400"]));
  });

  it("reads frDocumentNumber/documentNumber fields when present", () => {
    expect(frDocNumbersFromEvents([{ sourceUrl: "https://x/1", frDocumentNumber: "2025-21671" }])).toEqual(new Set(["2025-21671"]));
    expect(frDocNumbersFromEvents([{ sourceUrl: "https://x/2", documentNumber: "2026-16979" }])).toEqual(new Set(["2026-16979"]));
  });

  it("picks up each FR doc number in relatedFrDocumentNumbers", () => {
    expect(frDocNumbersFromEvents([{ sourceUrl: "https://x/1", relatedFrDocumentNumbers: ["2025-19873", "2026-21755"] }])).toEqual(new Set(["2025-19873", "2026-21755"]));
  });

  it("the real data/policy-events.json yields the curated FR doc numbers", async () => {
    const nums = await curatedFrDocNumbers("data/policy-events.json");
    expect(nums.has("2026-16400")).toBe(true);
    expect(nums.has("2026-16979")).toBe(true);
    expect(nums.has("2025-21671")).toBe(true);
    expect(nums.has("2025-19873")).toBe(true);
    expect(nums.has("2026-21755")).toBe(true);
  });

  it("fails closed: rejects on a nonexistent path (including ENOENT)", async () => {
    await expect(curatedFrDocNumbers("data/definitely-missing.json")).rejects.toThrow();
  });

  it("fails closed: rejects on invalid JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "policy-bad-"));
    const file = path.join(dir, "policy-events.json");
    await writeFile(file, "{ not json", "utf8");
    try {
      await expect(curatedFrDocNumbers(file)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("the maritime suspension-end event's title mentions the Nov 10 end and the proposed-extension doc 2026-21755", async () => {
    const body = JSON.parse(await (await import("node:fs/promises")).readFile("data/policy-events.json", "utf8")) as { events: { id: string; title: string }[] };
    const title = body.events.find((e) => e.id === "ustr-301-maritime-suspension-end")!.title;
    expect(title).toContain("Nov 10");
    expect(title).toContain("2026-21755");
  });

  it.todo("step 7: one event, multiple FR docs (2025-19873 basis, 2026-21755 proposed extension) → one canonical row");
});

const store = () => ({
  upsertCatalyst: vi.fn(async (c: unknown) => ({ ...(c as object) } as Catalyst)),
  purgeByKeyPrefixExcept: vi.fn(async (_prefix: string, _keep: string[]) => {}),
});

describe("syncPolicyEvents", () => {
  it("upserts overlapping events with policy: dedupe keys and purges ids that left the file", async () => {
    const s = store();
    await syncPolicyEvents(s, {
      today: "2026-11-01",
      horizonDays: 400,
      file: "data/policy-events.json",
    });
    const rows = s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst);
    // File fixture has events from 2026-11-10 to 2027-04-26; with a 400-day horizon all but the
    // window event ending past the horizon stay (overlap is on [dateStart, dateEnd] vs horizon end).
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.ticker === null && r.status === "scheduled" && r.confidence === 0.95 && r.sourceTier === 1)).toBe(true);
    expect(rows.every((r) => r.dedupeKey.startsWith("policy:"))).toBe(true);
    expect(rows.some((r) => r.dedupeKey === "policy:s301-china-exclusions-end")).toBe(true);
    const keep = s.purgeByKeyPrefixExcept.mock.calls[0]![1];
    expect(keep).toEqual(rows.map((r) => r.dedupeKey));
  });

  it("keeps events whose window overlaps the horizon even when dateStart is out", async () => {
    const s = store();
    await syncPolicyEvents(s, { today: "2026-11-01", horizonDays: 150, file: "data/policy-events.json" });
    const rows = s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst);
    // 2026-12-04 event vs horizon end 2027-03-31 -> within horizon
    expect(rows.some((r) => r.dedupeKey === "policy:s232-polysilicon-effective")).toBe(true);
    // 2027-04-20 events are beyond 2027-03-31 -> dropped
    expect(rows.some((r) => r.dedupeKey === "policy:s232-wind-update-due")).toBe(false);
  });

  it("drops events entirely outside [today, today+horizon]", async () => {
    const s = store();
    await syncPolicyEvents(s, { today: "2020-01-01", horizonDays: 30, file: "data/policy-events.json" });
    expect(s.upsertCatalyst).not.toHaveBeenCalled();
    expect(s.purgeByKeyPrefixExcept).toHaveBeenCalledWith("policy:", []);
  });

  it("never throws on a missing or malformed file; logs instead", async () => {
    const s = store();
    const logs: string[] = [];
    await expect(syncPolicyEvents(s, { today: "2026-11-01", horizonDays: 10, file: "data/nope.json", log: (m) => logs.push(m) })).resolves.toBeUndefined();
    expect(logs.some((m) => m.includes("policy events failed"))).toBe(true);
    expect(s.upsertCatalyst).not.toHaveBeenCalled();
    await expect(syncPolicyEvents(s, { today: "2026-11-01", horizonDays: 10, file: "test/../package.json", log: () => {} })).resolves.toBeUndefined();
  });

  it("maps the event date to dateStart for the s301 exclusions end", async () => {
    const s = store();
    await syncPolicyEvents(s, { today: "2026-11-01", horizonDays: 200, file: "data/policy-events.json" });
    const rows = s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst);
    const row = rows.find((r) => r.dedupeKey === "policy:s301-china-exclusions-end")!;
    expect(row.dateStart).toBe("2026-11-10");
  });

  it("pins the government funding lapse date and title", async () => {
    const s = store();
    await syncPolicyEvents(s, { today: "2026-11-01", horizonDays: 200, file: "data/policy-events.json" });
    const rows = s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst);
    const row = rows.find((r) => r.dedupeKey === "policy:us-gov-funding-lapse-2026-12-12");
    expect(row).toBeDefined();
    expect(row!.dateStart).toBe("2026-12-12");
    expect(rows.some((r) => r.dateStart === "2026-12-11" && /funding/i.test(r.title))).toBe(false);
  });

  it("persists precision/impact from the file", async () => {
    const s = store();
    await syncPolicyEvents(s, { today: "2026-11-01", horizonDays: 200, file: "data/policy-events.json" });
    const rows = s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst);
    const estimated = rows.find((r) => r.dedupeKey === "policy:s232-robotics-update-due")!;
    expect(estimated.datePrecision).toBe("estimated");
    expect(estimated.kind).toBe("regulatory_decision");
  });
});
