import { describe, expect, it, vi } from "vitest";
import { syncPolicyEvents } from "../src/catalysts/policy.js";
import type { Catalyst } from "../src/types.js";

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

  it("persists precision/impact from the file", async () => {
    const s = store();
    await syncPolicyEvents(s, { today: "2026-11-01", horizonDays: 200, file: "data/policy-events.json" });
    const rows = s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst);
    const estimated = rows.find((r) => r.dedupeKey === "policy:s232-robotics-update-due")!;
    expect(estimated.datePrecision).toBe("estimated");
    expect(estimated.impactWeight).toBe(2);
    expect(estimated.kind).toBe("regulatory_decision");
  });
});
