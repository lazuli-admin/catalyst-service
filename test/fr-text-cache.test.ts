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

  it("second sync on a warm cache makes no raw-text fetches; NUL-laden proclamations still classify", async () => {
    const store = await memoryStore();
    const docs = [
      {
        title: "Adjusting Imports of Steel Into the United States",
        type: "Presidential Document",
        subtype: "Executive Order",
        effective_on: null,
        html_url: "https://www.federalregister.gov/d/2025-19826",
        abstract: "",
        document_number: "2025-19826",
        raw_text_url: "https://www.federalregister.gov/documents/full_text/raw/2025-19826.txt",
      },
      {
        title: "Declaring a National Emergency Relating to Aluminum Imports",
        type: "Presidential Document",
        subtype: "Proclamation",
        effective_on: null,
        html_url: "https://www.federalregister.gov/d/2026-00327",
        abstract: "",
        document_number: "2026-00327",
        raw_text_url: "https://www.federalregister.gov/documents/full_text/raw/2026-00327.txt",
      },
      {
        title: "Adjusting Imports of Aluminum Into the United States",
        type: "Presidential Document",
        subtype: "Proclamation",
        effective_on: null,
        html_url: "https://www.federalregister.gov/d/2026-10398",
        abstract: "",
        document_number: "2026-10398",
        raw_text_url: "https://www.federalregister.gov/documents/full_text/raw/2026-10398.txt",
      },
    ];
    const rawTexts: Record<string, string> = {
      "2025-19826":
        "By the power vested in me as President by the Constitution and the laws of the United States of America,\n\u0000\n\u0000\n" +
        "NOW, THEREFORE, I, the President, find that the circumstances require decisive action,\n" +
        "it is hereby ordered that the adjustments shall take effect effective November 10, 2026.",
      "2026-00327": "Proclamation 10811 of December 24, 2025\n\u0000\n\u0000\nI do hereby proclaim that the aluminum tariff shall be effective January 1, 2027.",
      "2026-10398": "Proclamation 10812 of December 24, 2025\n\u0000\n\u0000\nI do hereby proclaim that the steel tariff shall be effective January 1, 2027.",
    };
    const rawUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (!url.includes("documents.json")) {
        rawUrls.push(url);
        const docNumber = url.match(/(\d{4}-\d{5})\.txt/)?.[1] ?? "";
        return res(rawTexts[docNumber] ?? "");
      }
      return url.includes("PRESDOCU") ? res({ results: docs, total_pages: 1 }) : res({ results: [] });
    });
    const opts = { today: "2026-11-10", horizonDays: 60, sleep: async () => {} };
    await syncFederalRegister(store, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(rawUrls).toHaveLength(3);
    await syncFederalRegister(store, { ...opts, fetch: fetchImpl as unknown as typeof fetch });
    expect(rawUrls).toHaveLength(3);
    const report = getLastFrSyncReport()!;
    expect(report.complete).toBe(true);
    expect(report.presidentialDrops).toBe(0);
    expect(report.noOperativeMarker).not.toContain("2025-19826");
    expect(report.noOperativeMarker).not.toContain("2026-00327");
    expect(report.noOperativeMarker).not.toContain("2026-10398");
    const keys = (await store.listCatalysts({ from: "2026-11-01", to: "2027-01-31", includeLeads: true })).map((c) => c.dedupeKey);
    for (const doc of docs) expect(keys.some((k) => k.startsWith(`fr:${doc.document_number}:`))).toBe(true);
  });
});
