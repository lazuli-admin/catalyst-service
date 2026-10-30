import { describe, expect, it, vi } from "vitest";
import { catalystDedupeKey, createCatalystExtractor, sanitizeCatalysts } from "../src/catalysts/extract.js";

const jsonRes = (content: string) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });

describe("catalystDedupeKey", () => {
  const c = { ticker: "AAPL", kind: "earnings", title: "Q1 2027 Earnings, Guidance & Call Today", dateStart: "2027-01-15" };
  it("is stable and normalized", () => {
    expect(catalystDedupeKey(c)).toBe(catalystDedupeKey({ ...c, ticker: "aapl", title: "q1 2027 earnings guidance call today and more" }));
    expect(catalystDedupeKey(c)).toBe("aapl|earnings|2027-01|q1 2027 earnings guidance call today");
  });
  it("handles null ticker", () => {
    expect(catalystDedupeKey({ ...c, ticker: null }).startsWith("-|")).toBe(true);
  });
});

describe("sanitizeCatalysts", () => {
  const today = "2026-02-10";
  it("falls back kind/status, swaps dates, clamps confidence, uppercases tickers, lowercases themes", () => {
    const [c] = sanitizeCatalysts(
      { catalysts: [{ ticker: "$aapl", kind: "nope", status: "weird", title: " T ", dateStart: "2026-03-05", dateEnd: "2026-03-01", confidence: 4, themes: [" EV "], affectedTickers: ["tsla"] }] },
      today,
    );
    expect(c).toEqual({ ticker: "AAPL", title: "T", kind: "other", status: "scheduled", dateStart: "2026-03-01", dateEnd: "2026-03-05", datePrecision: "window", confidence: 1, themes: ["ev"], affectedTickers: ["TSLA"] });
  });
  it("keeps a supplied datePrecision and derives exact for single-day events", () => {
    const [vague] = sanitizeCatalysts(
      { catalysts: [{ title: "mid-2026 launch", kind: "product_launch", status: "scheduled", dateStart: "2026-06-01", dateEnd: "2026-06-30", datePrecision: "estimated", confidence: 0.5, themes: [], affectedTickers: [] }] },
      today,
    );
    expect(vague?.datePrecision).toBe("estimated");
    const [single] = sanitizeCatalysts(
      { catalysts: [{ title: "one day", kind: "earnings", status: "confirmed", dateStart: "2026-03-10", dateEnd: "2026-03-10", confidence: 0.5, themes: [], affectedTickers: [] }] },
      today,
    );
    expect(single?.datePrecision).toBe("exact");
  });
  it("drops invalid dates, fully past windows and non-items, caps at 10", () => {
    const past = { title: "old", kind: "earnings", dateStart: "2025-01-01", dateEnd: "2025-02-01" };
    const good = { title: "new", kind: "earnings", dateStart: "2026-03-01", dateEnd: "2026-03-31" };
    expect(sanitizeCatalysts({ catalysts: [null, { title: "bad date", kind: "earnings", dateStart: "2026-13-01", dateEnd: "2026-03-01" }, past, ...Array.from({ length: 12 }, () => good)] }, today)).toHaveLength(10);
  });
  it("returns [] for non-object input", () => {
    expect(sanitizeCatalysts("nope", today)).toEqual([]);
  });
});

describe("createCatalystExtractor", () => {
  const llm = { apiKey: "k", baseUrl: "http://x/", model: "m" };
  it("happy path: quarter window resolved by LLM, sanitized", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(JSON.stringify({ catalysts: [{ ticker: "nvda", kind: "earnings", title: "Q1 2027 report", status: "confirmed", dateStart: "2027-02-15", dateEnd: "2027-03-31", confidence: 0.8, themes: ["AI"], affectedTickers: ["amd"] }] })));
    const { extract } = createCatalystExtractor(llm, { fetch: fetchImpl as unknown as typeof fetch, now: () => new Date("2026-02-10T00:00:00Z") });
    const out = await extract({ title: "Nvidia schedules next report" });
    expect(out).toEqual([{ ticker: "NVDA", kind: "earnings", title: "Q1 2027 report", status: "confirmed", dateStart: "2027-02-15", dateEnd: "2027-03-31", datePrecision: "window", confidence: 0.8, themes: ["ai"], affectedTickers: ["AMD"] }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://x/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.temperature).toBe(0);
    expect(body.messages[0].content).toContain("Today is 2026-02-10");
  });
  it("drops fully past-dated windows", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(JSON.stringify({ catalysts: [{ title: "old", kind: "earnings", dateStart: "2026-01-01", dateEnd: "2026-01-31" }] })));
    const { extract } = createCatalystExtractor(llm, { fetch: fetchImpl as unknown as typeof fetch, now: () => new Date("2026-02-10T00:00:00Z") });
    expect(await extract({ title: "x" })).toEqual([]);
  });
  it("malformed JSON and non-2xx return []", async () => {
    const bad = createCatalystExtractor(llm, { fetch: (async () => jsonRes("{oops")) as unknown as typeof fetch, now: () => new Date("2026-02-10") });
    expect(await bad.extract({ title: "x" })).toEqual([]);
    const err = createCatalystExtractor(llm, { fetch: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch, now: () => new Date("2026-02-10") });
    expect(await err.extract({ title: "x" })).toEqual([]);
  });
});
