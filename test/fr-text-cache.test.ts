import { describe, expect, it, vi } from "vitest";
import { getLastFrSyncReport, syncFederalRegister } from "../src/catalysts/federal-register.js";
import { memoryStore } from "./helpers.js";

const res = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const RAW_URL = "https://www.federalregister.gov/documents/full_text/raw/2026-26301.txt";
const RAW_TEXT = "Adjusted imports of steel shall apply on or after 12:01 a.m. eastern time on December 4, 2026.";
const DOC = {
  title: "Adjusting Imports of Steel Into the United States Under Section 232",
  type: "Presidential Document",
  subtype: "Proclamation",
  effective_on: null,
  html_url: "https://www.federalregister.gov/d/2026-26301",
  abstract: "",
  document_number: "2026-26301",
  raw_text_url: RAW_URL,
};
const opts = { today: "2026-11-01", horizonDays: 60, sleep: async () => {} };

describe("fr_text_cache", () => {
  it("put/get round-trip; unknown document numbers return null; put overwrites", async () => {
    const store = await memoryStore();
    expect(await store.getFrText("2026-26301")).toBeNull();
    await store.putFrText("2026-26301", RAW_TEXT);
    expect(await store.getFrText("2026-26301")).toBe(RAW_TEXT);
    await store.putFrText("2026-26301", RAW_TEXT + " amended");
    expect(await store.getFrText("2026-26301")).toBe(RAW_TEXT + " amended");
  });

  it("putFrText strips NUL characters so SQLite does not truncate the body", async () => {
    const store = await memoryStore();
    await store.putFrText("2026-26301", "head\u0000\nNOW, THEREFORE, I do hereby proclaim");
    expect(await store.getFrText("2026-26301")).toContain("proclaim");
  });

  it("running the sync twice with the same store fetches the raw text only once", async () => {
    const store = await memoryStore();
    const rawUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (!url.includes("documents.json")) {
        rawUrls.push(url);
        return res(RAW_TEXT);
      }
      return url.includes("PRESDOCU") ? res({ results: [DOC], total_pages: 1 }) : res({ results: [] });
    });
    await syncFederalRegister(store, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    await syncFederalRegister(store, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(rawUrls).toEqual([RAW_URL]);
    expect(getLastFrSyncReport()!.complete).toBe(true);
  });
});
