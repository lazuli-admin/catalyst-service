import { describe, expect, it } from "vitest";
import { runProspect } from "../src/catalysts/prospect.js";
import type { ExtractedCatalyst } from "../src/catalysts/extract.js";
import { fakeFetch, memoryStore } from "./helpers.js";

const RSS = `<?xml version="1.0"?><rss><channel>
  <item><title>Nvidia earnings call expected to be moved up</title><link>https://www.reuters.com/article/nvidia-earnings</link><guid>r1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
  <item><title>Random blog thinks Nvidia might do something</title><link>https://some-random-blog.com/nvidia</link><guid>b1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
</channel></rss>`;

const extracted: ExtractedCatalyst[] = [
  {
    ticker: "NVDA",
    title: "Nvidia earnings call",
    kind: "earnings",
    status: "expected",
    dateStart: "2024-03-01",
    dateEnd: "2024-03-01",
    confidence: 0.9,
    themes: ["ai"],
    affectedTickers: [],
  },
];

describe("runProspect", () => {
  it("extracts only tier 1-2 items and stores them with the source tier", async () => {
    const store = await memoryStore();
    const seen: string[] = [];
    const extractor = {
      extract: async (item: { title: string }) => {
        seen.push(item.title);
        return extracted;
      },
    };

    const result = await runProspect(
      { store, extractor, fetch: fakeFetch({ "https://news.google.com": RSS }), now: () => new Date("2024-01-01T00:00:00Z") },
      { watchlist: ["NVDA"], themes: [], maxItems: 10, perQuery: 5 },
    );

    expect(seen).toEqual(["Nvidia earnings call expected to be moved up"]);
    expect(result.stored).toBe(1);
    const list = await store.listCatalysts({ from: "2024-01-01", to: "2024-12-31" });
    expect(list).toHaveLength(1);
    expect(list[0]!.sourceTier).toBe(2);
    expect(list[0]!.sourceUrl).toBe("https://www.reuters.com/article/nvidia-earnings");
  });
});
