import { catalystDensity } from "./density.js";
import { rankCatalysts } from "./ranked.js";
import type { Catalyst } from "../types.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (d: string) => {
  const [y = 0, m = 1, day = 1] = d.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]} ${MONTHS[m - 1]} ${day}`;
};
const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? esc(u) : null);

/** Server-rendered calendar page over ranked catalysts. Pure; all text is HTML-escaped. */
export function renderCalendarPage(opts: { cats: Catalyst[]; asOf: string; all: boolean }): string {
  const ranked = rankCatalysts(opts.cats, { asOf: opts.asOf, all: opts.all });
  const byDate = new Map<string, typeof ranked>();
  for (const r of ranked) {
    const list = byDate.get(r.dateStart) ?? [];
    list.push(r);
    byDate.set(r.dateStart, list);
  }
  const rows = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([date, items]) =>
        `<h2>${esc(dateLabel(date))}</h2><ul>${items
          .map((r) => {
            const name = r.ticker ?? r.themes[0] ?? "MACRO";
            const href = safeHref(r.sourceUrl);
            const source = href ? ` <a href="${href}" target="_blank" rel="noopener">source</a>` : "";
            return `<li>${r.focus ? "★" : ""}${r.pinned ? " 📌" : ""} <span class="score">${r.score.toFixed(1)}</span> <span class="badge b-${r.bucket}">${r.bucket}</span> <strong>${esc(name)}</strong> ${esc(r.title)} <span class="kind">${esc(r.kind)}</span>${source}</li>`;
          })
          .join("")}</ul>`,
    )
    .join("");
  const clusters = catalystDensity(opts.cats, { asOf: opts.asOf })
    .filter((d) => d.clusters.length > 0)
    .map(
      (d) =>
        `<li><strong>${esc(d.ticker)}</strong> (${d.score.toFixed(1)}): ${d.clusters
          .map((c) => `${esc(dateLabel(c.start))} – ${esc(dateLabel(c.end))} [${c.kinds.map(esc).join(", ")}]`)
          .join("; ")}</li>`,
    )
    .join("");
  const toggle = opts.all ? `<a href="?">ranked view</a>` : `<a href="?all=1">show all</a>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalyst calendar</title><style>
body{background:#111;color:#ddd;font-family:system-ui,sans-serif;max-width:40rem;margin:1rem auto;padding:0 1rem;line-height:1.4}
a{color:#8ab4f8}
ul{list-style:none;padding:0}li{padding:.35rem 0;border-bottom:1px solid #2a2a2a}
h2{font-size:1rem;margin:1.2rem 0 .3rem;color:#aaa;text-transform:uppercase}
.score{display:inline-block;min-width:2.6rem;color:#e8c547;font-variant-numeric:tabular-nums}
.badge{padding:.05rem .45rem;border-radius:.7rem;font-size:.72rem;color:#eee}
.b-priced{background:#7a2222}.b-actionable{background:#2c6e2c}.b-watchlist{background:#7a6a22}.b-distant{background:#444}
.kind{color:#888;font-size:.85rem}
</style></head><body>
<h1>Catalyst calendar</h1>
<p>${toggle}</p>
<h2>Dense clusters</h2><ul>${clusters || "<li>None</li>"}</ul>
${rows || "<p>No upcoming catalysts.</p>"}
</body></html>`;
}
