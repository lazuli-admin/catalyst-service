import { describe, expect, it, vi } from "vitest";
import { createCatalystExtractor, type ExtractedCatalyst } from "../src/catalysts/extract.js";
import { runProspect } from "../src/catalysts/prospect.js";
import { fixedClock } from "../src/clock.js";
import { processItems } from "../src/pipeline.js";
import { deps, fakeFetch, memoryStore } from "./helpers.js";

// 03:30 UTC is 11:30 PM ET (EDT): the market day is still 2026-03-10 while the UTC date is already 2026-03-11.
const AT = "2026-03-11T03:30:00Z";
const TODAY = "2026-03-10";
// acceptCatalyst accepts a dateStart up to 730 days out, so these two pin "today" exactly.
const EDGE_OK = "2028-03-09"; // exactly 730 days after 2026-03-10
const EDGE_LATE = "2028-03-10"; // 731 days after, only accepted if today were later

const PROSPECT_RSS = `<?xml version="1.0"?><rss><channel>
  <item><title>Nvidia earnings call expected to be moved up</title><link>https://www.reuters.com/article/nvidia-earnings</link><guid>r1</guid><pubDate>Wed, 11 Mar 2026 03:00:00 GMT</pubDate></item>
</channel></rss>`;

const cat = (dateStart: string, title = "Nvidia earnings call"): ExtractedCatalyst => ({
  ticker: "NVDA",
  title,
  kind: "earnings",
  status: "scheduled",
  dateStart,
  dateEnd: dateStart,
  datePrecision: "exact",
  confidence: 0.8,
  themes: [],
  affectedTickers: [],
});

describe("day boundary: 03:30 UTC is still the previous ET market day", () => {
  it("extractor prompts and sanitizes with the ET date, not the UTC date", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ catalysts: [cat(TODAY)] }) } }] }) }));
    const { extract } = createCatalystExtractor({ apiKey: "k", baseUrl: "http://x/", model: "m" }, { fetch: fetchImpl as unknown as typeof fetch, clock: fixedClock(AT) });
    const out = await extract({ title: "Nvidia schedules next report" });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.messages[0].content).toContain("Today is 2026-03-10");
    // A catalyst dated today (2026-03-10) is not dropped as past.
    expect(out).toEqual([cat(TODAY)]);
  });

  it("runProspect gates against the ET date", async () => {
    const store = await memoryStore();
    const extractor = { extract: async () => [cat(EDGE_OK, "Nvidia earnings call"), cat(EDGE_LATE, "Nvidia earnings call later")] };
    const result = await runProspect(
      { store, extractor, fetch: fakeFetch({ "https://news.google.com": PROSPECT_RSS }), clock: fixedClock(AT) },
      { watchlist: ["NVDA"], themes: [], maxItems: 10, perQuery: 5 },
    );
    expect(result.stored).toBe(1);
    const list = await store.listCatalysts({ from: "2028-01-01", to: "2028-12-31", includeLeads: true });
    expect(list).toHaveLength(1);
    expect(list[0]!.dateStart).toBe(EDGE_OK);
  });

  it("pipeline mineCatalysts gates against the ET date", async () => {
    const store = await memoryStore();
    await store.createEntity({ name: "NVDA", kind: "ticker", aliases: ["Nvidia"] });
    const source = await store.createSource({ type: "push", name: "test", config: {} });
    const extractor = { extract: async () => [cat(EDGE_OK, "Product launch A"), cat(EDGE_LATE, "Product launch B")] };
    await processItems(deps(store, { clock: fixedClock(AT), catalysts: extractor }), source, [{ externalId: "1", title: "Nvidia schedules product launch for March 10", url: "https://www.reuters.com/1" }]);
    const list = await store.listCatalysts({ from: "2028-01-01", to: "2028-12-31", includeLeads: true });
    expect(list).toHaveLength(1);
    expect(list[0]!.dateStart).toBe(EDGE_OK);
    expect(list[0]!.title).toBe("Product launch A");
  });
});
