import { describe, expect, it, vi } from "vitest";
import { syncPrimaryMacro, parseFomcMeetings } from "../src/catalysts/macro-primary.js";
import type { Catalyst } from "../src/types.js";

const BEA_URL = "https://apps.bea.gov/API/signup/release_dates.json";
const FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

const res = (body: unknown) => ({ ok: true, json: async () => body, text: async () => String(body) });

const BEA_BODY = {
  "Gross Domestic Product": { release_dates: ["2026-02-19T13:30:00+00:00", "2026-03-01T02:30:00+00:00"] },
  "Personal Income and Outlays": { release_dates: ["2026-02-06T13:30:00+00:00"] },
  "U.S. International Trade in Goods and Services": { release_dates: ["2026-02-05T13:30:00+00:00"] },
};

// Real federalreserve.gov markup: date text sits directly in the fomc-meeting__date div (no <p>);
// "fomc-meeting__month" also appears inside "fomc-meeting--shaded fomc-meeting__month".
const FOMC_HTML = `<h4><a id="42828">2026 FOMC Meetings</a></h4>
<div class="fomc-meeting--shaded fomc-meeting"><div class="fomc-meeting--shaded fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>December</strong></div><div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">8-9*</div></div>
<div class="fomc-meeting"><div class="fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>January</strong></div><div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">27-28</div></div>
<h4><a id="42999">2025 FOMC Meetings</a></h4>
<div class="fomc-meeting"><div class="fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>January</strong></div><div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">28-29</div></div>`;

function mockFetch(bea: unknown, fomc: unknown) {
  return vi.fn(async (url: string) => (url === BEA_URL ? res(bea) : url === FOMC_URL ? res(fomc) : res({})));
}

const store = () => ({ upsertCatalyst: vi.fn(async (c: unknown) => ({ ...(c as object) } as Catalyst)) });

const rows = (s: ReturnType<typeof store>) => s.upsertCatalyst.mock.calls.map(([c]) => c as Catalyst & { dedupeKey: string });

// BLS fixture: real data/bls-schedule.json (Nov/Dec 2026 releases).
const BLS_FILE = new URL("../data/bls-schedule.json", import.meta.url).pathname;
const opts = { today: "2026-11-04", horizonDays: 40, blsSchedule: BLS_FILE };

describe("syncPrimaryMacro", () => {
  it("maps BLS entries with series/release title, source url and dedupe key; only in-window rows", async () => {
    const s = store();
    const count = await syncPrimaryMacro(s as never, { ...opts, fetch: mockFetch({}, "") as unknown as typeof fetch });
    const bls = rows(s).filter((r) => r.dedupeKey.startsWith("bls:"));
    expect(bls.map((r) => [r.title, r.dedupeKey, r.sourceUrl])).toEqual([
      ["US Jobs report: Employment Situation (jobs report) for October 2026", "bls:Jobs report:2026-11-06", "https://www.bls.gov/schedule/2026/11_sched_list.htm"],
      ["US CPI: Consumer Price Index (CPI) for October 2026", "bls:CPI:2026-11-10", "https://www.bls.gov/schedule/2026/11_sched_list.htm"],
      ["US PPI: Producer Price Index (PPI) for October 2026", "bls:PPI:2026-11-13", "https://www.bls.gov/schedule/2026/11_sched_list.htm"],
      ["US JOLTS: Job Openings and Labor Turnover Survey (JOLTS) for October 2026", "bls:JOLTS:2026-12-01", "https://www.bls.gov/schedule/2026/12_sched_list.htm"],
      ["US Jobs report: Employment Situation (jobs report) for November 2026", "bls:Jobs report:2026-12-04", "https://www.bls.gov/schedule/2026/12_sched_list.htm"],
      ["US CPI: Consumer Price Index (CPI) for November 2026", "bls:CPI:2026-12-10", "https://www.bls.gov/schedule/2026/12_sched_list.htm"],
    ]);
    expect(bls.every((r) => r.sourceTier === 1 && r.confidence === 1 && r.status === "scheduled" && r.datePrecision === "exact" && r.ticker === null && r.kind === "macro")).toBe(true);
    expect(count).toBe(bls.length);
  });

  it("filters BEA to PCE/GDP and converts release dates to America/New_York", async () => {
    const s = store();
    await syncPrimaryMacro(s as never, { today: "2026-02-01", horizonDays: 40, blsSchedule: "/nonexistent.json", fetch: mockFetch(BEA_BODY, "") as unknown as typeof fetch });
    const bea = rows(s).filter((r) => r.dedupeKey.startsWith("bea:"));
    // 13:30Z -> same day ET; 02:30Z on Mar 1 -> still Feb 28 ET; trade release filtered out.
    expect(bea.map((r) => [r.title, r.dateStart, r.dedupeKey]).sort()).toEqual([
      ["US GDP: Gross Domestic Product", "2026-02-19", "bea:GDP:2026-02-19"],
      ["US GDP: Gross Domestic Product", "2026-02-28", "bea:GDP:2026-02-28"],
      ["US PCE: Personal Income and Outlays", "2026-02-06", "bea:PCE:2026-02-06"],
    ]);
    expect(bea.every((r) => r.sourceUrl === "https://www.bea.gov/news/schedule")).toBe(true);
  });

  it("parses FOMC meetings from real markup: shaded/unshaded rows, SEP star; ignores other years", async () => {
    expect(parseFomcMeetings(FOMC_HTML, 2026)).toEqual([
      { dateStart: "2026-12-08", dateEnd: "2026-12-09", sep: true },
      { dateStart: "2026-01-27", dateEnd: "2026-01-28", sep: false },
    ]);
    const s = store();
    await syncPrimaryMacro(s as never, { today: "2026-12-01", horizonDays: 30, blsSchedule: "/nonexistent.json", fetch: mockFetch({}, FOMC_HTML) as unknown as typeof fetch });
    const fed = rows(s).filter((r) => r.dedupeKey.startsWith("fed:"));
    expect(fed.map((r) => [r.title, r.dateStart, r.dateEnd, r.dedupeKey])).toEqual([
      ["FOMC meeting (rate decision day 2) + SEP", "2026-12-08", "2026-12-09", "fed:fomc:2026-12-08"],
    ]);
    expect(fed.every((r) => r.sourceUrl === FOMC_URL && r.confidence === 1 && r.sourceTier === 1)).toBe(true);
  });

  it("a failing source does not stop the others", async () => {
    const fomc = `<h5>2026 FOMC Meetings</h5><div class="fomc-meeting"><div class="fomc-meeting__month"><strong>December</strong></div><div class="fomc-meeting__date"><p>8-9*</p></div></div>`;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === BEA_URL) throw new Error("bea down");
      if (url === FOMC_URL) return res(fomc);
      return res({});
    });
    const s = store();
    const log = vi.fn();
    await syncPrimaryMacro(s as never, { ...opts, fetch: fetchImpl as unknown as typeof fetch, log });
    expect(log).toHaveBeenCalledWith("macro bea failed: bea down");
    expect(rows(s).some((r) => r.dedupeKey.startsWith("bls:"))).toBe(true);
    expect(rows(s).some((r) => r.dedupeKey.startsWith("fed:"))).toBe(true);
    expect(rows(s).some((r) => r.dedupeKey.startsWith("bea:"))).toBe(false);
  });
});
