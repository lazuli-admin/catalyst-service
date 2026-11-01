import { rankCatalysts } from "./ranked.js";
import { catalystDensity, CLUSTER_SPAN_DAYS, KIND_WEIGHTS, CLUSTER_BONUS_PER_KIND, isPolicyCatalyst, type TickerDensity } from "./density.js";
import { sectorOf } from "./sectors.js";
import type { Catalyst } from "../types.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? esc(u) : null);
/** Strict YYYY-MM-DD: regex plus round-trip, so 2026-02-30 does not silently roll over. */
export const isDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; // clock-guard: pure-date
};

/** Sunday of the week containing the given YYYY-MM-DD date (UTC). */
export function weekSunday(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  return new Date(t - new Date(t).getUTCDay() * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
}

type Ranked = Catalyst & { score: number; focus?: boolean; pinned?: boolean };

/** Canonical query string: week, all=1, hide=<sorted> in that order; "?" alone when all empty. */
const href = (p: { week?: string; all: boolean; hide: string[] }) =>
  `?${[p.week ? `week=${p.week}` : null, p.all ? "all=1" : null, p.hide.length ? `hide=${[...p.hide].sort().join(",")}` : null].filter(Boolean).join("&")}`;

function chip(r: Ranked, asOf: string): string {
  const href = safeHref(r.sourceUrl);
  const source = href ? ` <a href="${href}" target="_blank" rel="noopener">source</a>` : "";
  const kind = r.kind === "earnings" ? "k-earnings" : r.kind === "macro" ? "k-macro" : r.kind === "election" ? "k-election" : "k-other";
  const flag = `${r.focus ? "★" : ""}${r.pinned ? " 📌" : ""}`;
  const name = r.ticker ? `<strong>${esc(r.ticker)}</strong> ` : "";
  const n = (Date.parse(`${r.dateStart}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000;
  const until = n === 0 ? "today" : `in ${n}d`;
  return `<div class="chip ${kind}">${flag} ${name}${esc(r.title)} <span class="until">${esc(until)}</span>${source}</div>`;
}

/** Short name for a cluster summary: "NVDA earnings" for ticked events, trimmed rule titles for tickerless ones. */
const shortName = (c: Catalyst) =>
  c.ticker
    ? `${c.ticker} ${c.kind.replace(/_/g, " ")}`
    : c.title.split(" — ")[0]!.replace(/ back in force\b.*$/, "").replace(/:$/, "").trim();

/** "Nov 10–17" within one month, "Nov 10 – Dec 1" across months. */
const dateSpan = (start: string, end: string) => {
  const [, sm = 1, sd = 1] = start.split("-").map(Number);
  const [, em = 1, ed = 1] = end.split("-").map(Number);
  return sm === em ? `${MONTHS[sm - 1]} ${sd}–${ed}` : `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}`;
};

/** Merged cluster summary for the page: one entry per group of per-ticker clusters sharing a tickerless catalyst. */
export interface MaterialCluster {
  score: number;
  start: string;
  end: string;
  /** Union of the member clusters' events, dedupe by id, sorted by date then id. */
  events: Catalyst[];
  affectedTickers: string[];
  themes: string[];
  kinds: Catalyst["kind"][];
}

/** Merge per-ticker clusters that share any tickerless catalyst (same id) into one cluster each. Pure. */
export function mergeSharedClusters(dens: TickerDensity[]): MaterialCluster[] {
  type Node = MaterialCluster & { ids: Set<string> };
  const nodes: Node[] = [];
  for (const d of dens) {
    for (const cluster of d.clusters) {
      const events = d.items.map((i) => i.catalyst).filter((c) => c.dateStart >= cluster.start && c.dateStart <= cluster.end);
      nodes.push({
        score: d.score,
        start: cluster.start,
        end: cluster.end,
        events,
        affectedTickers: [...new Set(events.flatMap((c) => c.affectedTickers))],
        themes: [...new Set(events.flatMap((c) => c.themes))],
        kinds: [...new Set(events.map((c) => c.kind))],
        ids: new Set(events.map((c) => c.id)),
      });
    }
  }
  const merged: Node[] = [];
  for (const node of nodes) {
    // Only a tickerless catalyst (it appears under each affected ticker) links clusters across tickers.
    const anchor = [...node.ids].find((id) => node.events.find((e) => e.id === id)?.ticker === null);
    const target = anchor ? merged.find((m) => m.ids.has(anchor)) : undefined;
    if (!target) {
      merged.push(node);
      continue;
    }
    for (const e of node.events) if (!target.ids.has(e.id)) (target.ids.add(e.id), target.events.push(e));
    target.affectedTickers = [...new Set([...target.affectedTickers, ...node.affectedTickers])];
    target.themes = [...new Set([...target.themes, ...node.themes])];
    target.kinds = [...new Set([...target.kinds, ...node.kinds])];
    target.score = Math.max(target.score, node.score);
    target.start = target.start < node.start ? target.start : node.start;
    target.end = target.end > node.end ? target.end : node.end;
  }
  for (const m of merged) m.events.sort((a, b) => Date.parse(a.dateStart) - Date.parse(b.dateStart) || a.id.localeCompare(b.id));
  return merged;
}

/** Server-rendered weekly calendar page over ranked catalysts. Pure; all text is HTML-escaped. */
export function renderCalendarPage(opts: { cats: Catalyst[]; asOf: string; all: boolean; week?: string; hide?: string }): string {
  // All-or-nothing: any invalid token drops the whole hide param, so bad input renders as no-hide.
  const tokens = (opts.hide ?? "").split(",");
  const hidden = new Set(
    tokens.every((g) => g === "earnings" || g === "macro" || g === "policy" || g === "global")
      ? (tokens as ("earnings" | "macro" | "policy" | "global")[])
      : [],
  );
  const groupOf = (c: Catalyst) => (isPolicyCatalyst(c) ? "policy" : c.kind === "earnings" ? "earnings" : c.kind === "macro" ? "macro" : "global");
  const week = weekSunday(opts.week && isDate(opts.week) ? opts.week : opts.asOf);
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${week}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)); // clock-guard: pure-date
  const ranked = rankCatalysts(opts.cats, { asOf: opts.asOf, all: opts.all }).filter((r) => r.dateEnd >= (days[0] ?? "") && r.dateStart <= (days[6] ?? ""));
  const byDate = new Map<string, Ranked[]>();
  for (const r of ranked) {
    for (let d = Date.parse(`${r.dateStart}T00:00:00Z`); d <= Date.parse(`${r.dateEnd}T00:00:00Z`); d += 86_400_000) {
      const date = new Date(d).toISOString().slice(0, 10); // clock-guard: pure-date
      if (date < (days[0] ?? "") || date > (days[6] ?? "")) continue; // clip to the shown week
      const list = byDate.get(date) ?? [];
      list.push(r);
      byDate.set(date, list);
    }
  }
  
  // Generate material clusters section
  const density = catalystDensity(opts.cats, { asOf: opts.asOf });
  const materialClusters = mergeSharedClusters(density)
    .sort((a, b) => b.score - a.score)
    .map(mc => {
      // Build events list, showing each event's date certainty (exact / window / estimated)
      const events = mc.events
        .map(c => {
          const eventDate = c.dateStart;
          const eventKind = c.kind;
          const eventTitle = esc(c.title);
          const eventSource = c.sourceUrl ? `<a href="${safeHref(c.sourceUrl)!}" target="_blank" rel="noopener">source</a>` : "";
          return `<li>${eventDate} (${esc(c.datePrecision)}) ${eventKind} ${eventTitle} ${eventSource}</li>`;
        })
        .join("");
      // A BIS rule dominating a cluster gets a fixed label instead of the joined short names.
      const names = mc.events.some((c) => c.title.startsWith("BIS")) ? "BIS export controls · semis" : [...new Set(mc.events.map(shortName))].join(" + ");
      
      const k = mc.kinds.length;
      const days = Math.round((Date.parse(`${mc.start}T00:00:00Z`) - Date.parse(`${opts.asOf}T00:00:00Z`)) / 86_400_000);
      const whyMaterial = esc(`${k} distinct catalyst types within ${CLUSTER_SPAN_DAYS} trading days (` + mc.kinds.map(kind => `${kind}: tier ${KIND_WEIGHTS[kind]}`).join(", ") + `); cluster bonus +${(CLUSTER_BONUS_PER_KIND*(k-1)).toFixed(1)}; first event ${days === 0 ? "today" : `in ${days}d`}.`);

      const affectedTickers = esc(mc.affectedTickers.join(", "));
      const themes = esc(mc.themes.join(", "));
      const mainTicker = mc.events.map(c => c.ticker).find(Boolean) ?? "";
      
      return `<details class="cluster"><summary>${esc(names)} · ${mc.score.toFixed(1)} · ${esc(dateSpan(mc.start, mc.end))}</summary>
        <ul>${events}</ul>
        <p>Why material: ${whyMaterial}</p>
        <p>Likely affected: ${affectedTickers || "none"}; Themes: ${themes || "none"}</p>
        <p>Sector: ${esc(sectorOf(mainTicker).sector)}; peers: ${esc(sectorOf(mainTicker).peers.join(", "))}</p>
      </details>`;
    })
    .join("");
  
  const dayCell = (date: string) => {
    const items = byDate.get(date) ?? [];
    const shown: string[] = [];
    const collapsed: Ranked[] = [];
    for (const r of items) {
      if (hidden.has(groupOf(r))) continue;
      if (r.kind === "earnings" && !r.focus && !r.themes.includes("megacap")) collapsed.push(r);
      else shown.push(chip(r, opts.asOf));
    }
    if (collapsed.length) {
      const tickers = collapsed.map((r) => `<div>${esc(r.ticker ?? r.title)}</div>`).join("");
      shown.push(`<details class="chip k-earnings"><summary>+${collapsed.length} earnings</summary>${tickers}</details>`);
    }
    const [, m = 1, d = 1] = date.split("-").map(Number);
    return `<div class="day${date === opts.asOf ? " today" : ""}"><h3>${MONTHS[m - 1]} ${d}</h3>${shown.join("")}</div>`;
  };
  // Pure: max updatedAt among the rendered catalysts, truncated to the minute.
  const refreshed = opts.cats.length
    ? opts.cats.reduce((m, c) => (c.updatedAt > m ? c.updatedAt : m), opts.cats[0]!.updatedAt).slice(0, 16)
    : "never";
  const [wy = 0, wm = 0, wd = 0] = week.split("-").map(Number);
  const hasWeek = !!(opts.week && isDate(opts.week));
  const keep = { all: opts.all, hide: [...hidden] };
  const prev = new Date(Date.parse(`${week}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
  const next = new Date(Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
  const pills = (["earnings", "macro", "policy", "global"] as const)
    .map((g) => {
      const on = !hidden.has(g);
      const hideNext = on ? [...hidden, g] : [...hidden].filter((x) => x !== g);
      return `<a class="pill ${on ? "pill-on" : "pill-off"}" aria-pressed="${on}" href="${href({ week: hasWeek ? week : undefined, ...keep, hide: hideNext })}">${on ? "✓ " : ""}${g.charAt(0).toUpperCase()}${g.slice(1)}</a>`;
    })
    .join(" ");
  const toggle = opts.all
    ? `<a href="${href({ all: false, hide: [...hidden] })}">ranked view</a>`
    : `<a href="${href({ week: hasWeek ? week : undefined, all: true, hide: [...hidden] })}">show all</a>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalyst calendar</title><style>
body{background:#111;color:#ddd;font-family:system-ui,sans-serif;margin:1rem auto;padding:0 1rem;line-height:1.4}
a{color:#8ab4f8}
header{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
h1{font-size:1.1rem;margin:0}
.weekwrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.week{display:grid;grid-template-columns:repeat(7,minmax(7.5rem,1fr));gap:2px;min-width:52.5rem;margin-top:.8rem}
.day{background:#1a1a1a;border:1px solid #2a2a2a;padding:.3rem;min-height:6rem}
.day h3{font-size:.75rem;margin:0 0 .3rem;color:#999;font-weight:600}
.day.today h3{color:#8ab4f8}
.chip{border-radius:.3rem;padding:.2rem .3rem;margin:.25rem 0;font-size:.78rem;overflow-wrap:anywhere}
.k-earnings{background:#1d3a1d}.k-macro{background:#1d2f4a}.k-election{background:#3a1d3a}.k-other{background:#3a2d1d}
.chip summary{cursor:pointer}
.chip a{font-size:.72rem}
.until{font-size:.72rem;color:#999}
.pill{display:inline-block;padding:.25rem .7rem;border-radius:999px;border:1px solid #2a2a2a;text-decoration:none;min-height:1.7rem}
.pill-on{background:#8ab4f8;color:#111;border-color:#8ab4f8}
.pill-off{background:transparent;color:#8ab4f8;text-decoration:line-through}
.cluster{margin:1rem 0;border:1px solid #333;padding:.5rem;border-radius:.3rem}
.cluster summary{cursor:pointer;font-weight:bold}
.cluster ul{margin:0;padding-left:1rem}
@media (max-width:700px){
  .week{grid-template-columns:1fr;min-width:0}
  .weekwrap{overflow-x:visible}
  .day h3{position:sticky;top:0;background:#1a1a1a;z-index:1;padding:.3rem .5rem}
  .chip{width:100%}
  header{gap:.5rem}
  .pill,.cluster summary{min-height:40px;display:flex;align-items:center}
}
</style></head><body>
<header><h1>Catalyst calendar — Week of ${MONTHS[wm - 1] ?? ''} ${wd ?? ''}, ${wy ?? ''}</h1><span>Last refreshed: ${refreshed === "never" ? "never" : `${refreshed} UTC`}</span> <a href="${href({ week: prev, ...keep })}">‹ Prev</a> <a href="${href(keep)}">Today</a> <a href="${href({ week: next, ...keep })}">Next ›</a> ${toggle} <nav class="pills">${pills}</nav></header>
<h2>Material clusters</h2>
${materialClusters || '<p>No material clusters found.</p>'}
<div class="weekwrap"><div class="week">${days.map(dayCell).join("")}</div></div>
</body></html>`;
}