import { describe, expect, it } from "vitest";
import { acceptCatalyst, sourceTier } from "../src/catalysts/credibility.js";

describe("sourceTier", () => {
  it("returns tier 1 for primary sources", () => {
    expect(sourceTier({ url: "https://www.sec.gov/Archives/edgar/data/1018724/000162828024002399/tsla-20231231.htm" })).toBe(1);
    expect(sourceTier({ url: "https://www.federalregister.gov/documents/2024/01/01/2024-00001/some-rule" })).toBe(1);
    expect(sourceTier({ url: "https://www.businesswire.com/news/home/20240101000000/en/Some-News" })).toBe(1);
    expect(sourceTier({ url: "https://ir.tesla.com/press-release/some-news" })).toBe(1);
    expect(sourceTier({ url: "https://investor.apple.com/news" })).toBe(1);
  });

  it("returns tier 2 for reputable press", () => {
    expect(sourceTier({ url: "https://www.reuters.com/article/us-usa-epa-idUSKBN1E60BN" })).toBe(2);
    expect(sourceTier({ url: "https://www.bloomberg.com/news/articles/2024-01-01/some-news" })).toBe(2);
    expect(sourceTier({ url: "https://www.wsj.com/articles/some-news" })).toBe(2);
    expect(sourceTier({ url: "https://www.ft.com/content/some-id" })).toBe(2);
    expect(sourceTier({ url: "https://www.cnbc.com/2024/01/01/some-news.html" })).toBe(2);
    expect(sourceTier({ url: "https://apnews.com/article/some-id" })).toBe(2);
    expect(sourceTier({ url: "https://www.nytimes.com/2024/01/01/business/some-news.html" })).toBe(2);
    expect(sourceTier({ url: "https://www.barrons.com/articles/some-news" })).toBe(2);
    expect(sourceTier({ url: "https://theinformation.com/articles/some-news" })).toBe(2);
    expect(sourceTier({ url: "https://asia.nikkei.com/Business/Some-News" })).toBe(2);
    expect(sourceTier({ url: "https://www.marketwatch.com/story/some-news" })).toBe(2);
    expect(sourceTier({ url: "https://www.axios.com/2024/01/01/some-news" })).toBe(2);
    expect(sourceTier({ url: "https://www.semafor.com/article/2024/01/01/some-news.html" })).toBe(2);
  });

  it("returns tier 1 or 2 for google news based on publisher suffix", () => {
    expect(sourceTier({ url: "https://news.google.com/rss/articles/CBMiKGh0dHBzOi8vd3d3LmJ1c2luZXNzd2lyZS5jb20v?oc=5", title: "Some News - Business Wire" })).toBe(1);
    expect(sourceTier({ url: "https://news.google.com/rss/articles/CBMiKGh0dHBzOi8vd3d3LnJldXRlcnMuY29tLw?oc=5", title: "Some News - Reuters" })).toBe(2);
    expect(sourceTier({ url: "https://news.google.com/rss/articles/CBMiKGh0dHBzOi8vd3d3LmJsb29tYmVyZy5jb20v?oc=5", title: "Some News - Bloomberg" })).toBe(2);
    expect(sourceTier({ url: "https://news.google.com/rss/articles/CBMiKGh0dHBzOi8vd3d3LnRoZXdhbGxzdHJlZXRqb3VybmFsLmNvbS8?oc=5", title: "Some News - The Wall Street Journal" })).toBe(2);
    expect(sourceTier({ url: "https://news.google.com/rss/articles/CBMiKGh0dHBzOi8vd3d3LnRoZS1pbmZvcm1hdGlvbi5jb20v?oc=5", title: "Some News - The Information" })).toBe(2);
    expect(sourceTier({ url: "https://news.google.com/rss/articles/CBMiKGh0dHBzOi8vd3d3LmJsb29tYmVyZy5jb20v?oc=5", title: "Some News - Some Random Blog" })).toBe(3);
  });

  it("returns tier 3 for untrusted sources", () => {
    expect(sourceTier({ url: "https://some-random-blog.com/news" })).toBe(3);
    expect(sourceTier({ url: "https://notreuters.com/news" })).toBe(3);
    expect(sourceTier({ url: null })).toBe(3);
    expect(sourceTier({})).toBe(3);
  });
});

describe("acceptCatalyst", () => {
  const today = "2024-01-01";

  it("accepts near-term tier 1 catalysts as calendar entries, tier 2 only as leads", () => {
    expect(acceptCatalyst({ dateStart: "2024-03-01", confidence: 0.4 }, 1, today)).toBe("calendar");
    expect(acceptCatalyst({ dateStart: "2024-03-01", confidence: 0.39 }, 1, today)).toBe(false);
    expect(acceptCatalyst({ dateStart: "2024-03-01", confidence: 0.4 }, 2, today)).toBe("lead");
    expect(acceptCatalyst({ dateStart: "2024-03-01", confidence: 0.39 }, 2, today)).toBe(false);
  });

  it("rejects tier 3 sources outright", () => {
    expect(acceptCatalyst({ dateStart: "2024-03-01", confidence: 1 }, 3, today)).toBe(false);
  });

  it("accepts far-term catalysts with stricter confidence", () => {
    expect(acceptCatalyst({ dateStart: "2025-01-01", confidence: 0.5 }, 1, today)).toBe("calendar");
    expect(acceptCatalyst({ dateStart: "2025-01-01", confidence: 0.49 }, 1, today)).toBe(false);
    expect(acceptCatalyst({ dateStart: "2025-01-01", confidence: 0.7 }, 2, today)).toBe("lead");
    expect(acceptCatalyst({ dateStart: "2025-01-01", confidence: 0.69 }, 2, today)).toBe(false);
  });

  it("rejects catalysts beyond 730 days", () => {
    expect(acceptCatalyst({ dateStart: "2026-01-01", confidence: 0.9 }, 1, today)).toBe(false);
    expect(acceptCatalyst({ dateStart: "2026-01-01", confidence: 0.9 }, 2, today)).toBe(false);
    expect(acceptCatalyst({ dateStart: "2026-01-01", confidence: 0.9 }, 3, today)).toBe(false);
  });
});
