import type { Catalyst, CatalystKind, CatalystStatus } from "../types.js";
import { clamp01, errorMessage } from "../util.js";

export type ExtractedCatalyst = Omit<Catalyst, "id" | "createdAt" | "updatedAt" | "observationId" | "sourceUrl" | "dedupeKey">;

const KINDS: readonly CatalystKind[] = ["earnings", "regulatory_decision", "approval", "patent_expiry", "lockup_expiry", "deal_close", "shareholder_vote", "product_launch", "buildout_completion", "rule_effective", "index_rebalance", "macro", "investor_event", "litigation", "other"];
const STATUSES: readonly CatalystStatus[] = ["expected", "confirmed", "occurred", "cancelled"];
const MAX_CATALYSTS = 10;

/** First 6 significant (alnum) words of the title, lowercased. */
function titleKey(title: string): string {
  return title.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 6).join(" ") ?? "";
}

export function catalystDedupeKey(c: { ticker: string | null; kind: string; title: string; dateStart: string }): string {
  return `${c.ticker ?? "-"}|${c.kind}|${c.dateStart.slice(0, 7)}|${titleKey(c.title)}`.toLowerCase();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_RE = /^[A-Z][A-Z0-9.-]*$/;

function cleanTicker(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const up = t.trim().replace(/^\$/, "").toUpperCase();
  return TICKER_RE.test(up) ? up : null;
}

function cleanList(values: unknown, clean: (v: unknown) => string | null): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(clean).filter((v): v is string => v !== null))];
}

export function sanitizeCatalysts(raw: unknown, today: string): ExtractedCatalyst[] {
  const items = (raw as { catalysts?: unknown } | null)?.catalysts;
  if (!Array.isArray(items)) return [];
  const out: ExtractedCatalyst[] = [];
  for (const item of items) {
    const c = item as Record<string, unknown> | null;
    if (!c || typeof c.title !== "string" || !c.title.trim()) continue;
    const kind = KINDS.includes(c.kind as CatalystKind) ? (c.kind as CatalystKind) : "other";
    const status = STATUSES.includes(c.status as CatalystStatus) ? (c.status as CatalystStatus) : "expected";
    const dates = [c.dateStart, c.dateEnd].map((d) => (typeof d === "string" && DATE_RE.test(d) ? d : null));
    if (dates.some((d) => d === null || Number.isNaN(Date.parse(d)))) continue;
    const [dateStart, dateEnd] = dates as [string, string];
    // A window that has already fully passed is worthless.
    if (dateEnd < today) continue;
    const [start, end] = dateStart <= dateEnd ? [dateStart, dateEnd] : [dateEnd, dateStart];
    const ticker = cleanTicker(c.ticker);
    const confidence = clamp01(typeof c.confidence === "number" && Number.isFinite(c.confidence) ? c.confidence : 0.5);
    out.push({
      ticker,
      title: c.title.trim(),
      kind,
      status,
      dateStart: start,
      dateEnd: end,
      confidence,
      themes: cleanList(c.themes, (t) => (typeof t === "string" && t.trim() ? t.trim().toLowerCase() : null)),
      affectedTickers: cleanList(c.affectedTickers, cleanTicker),
    });
    if (out.length >= MAX_CATALYSTS) break;
  }
  return out;
}

const SYSTEM_PROMPT = `Extract stock-moving FUTURE events from a news item into JSON {"catalysts":[{"ticker":string|null,"title":string,"kind":"earnings"|"regulatory_decision"|"approval"|"patent_expiry"|"lockup_expiry"|"deal_close"|"shareholder_vote"|"product_launch"|"buildout_completion"|"rule_effective"|"index_rebalance"|"macro"|"investor_event"|"litigation"|"other","status":"expected"|"confirmed","dateStart":"YYYY-MM-DD","dateEnd":"YYYY-MM-DD","confidence":0..1,"themes":[short lowercase strings],"affectedTickers":[tickers of other listed companies likely to react, e.g. suppliers/competitors]}]}.
Only events dated in the future or a future window that could move a stock: earnings, FDA/regulatory decisions, approvals, patent/exclusivity expiries, lockup expiries, deal closings, shareholder votes, launches, buildout/plant completions, rule effective dates, index rebalances, macro releases, investor days, court rulings. Resolve relative dates ("Q1 2027" -> 2027-01-01..2027-03-31, "first half", "mid-2026") using the given today date. Omit anything already fully in the past or that only reports past results. Return {"catalysts":[]} if none.`;

/**
 * LLM catalyst extractor: one chat-completions call, JSON mode, never throws.
 */
export function createCatalystExtractor(llm: { apiKey: string; baseUrl: string; model: string; maxTokens?: number }, opts?: { fetch?: typeof fetch; now?: () => Date }) {
  const fetchImpl = opts?.fetch ?? fetch;
  const now = opts?.now ?? (() => new Date());
  return {
    async extract(item: { title: string; summary?: string; url?: string | null; publishedAt?: string | null }): Promise<ExtractedCatalyst[]> {
      try {
        const res = await fetchImpl(`${llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
          headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
          body: JSON.stringify({
            model: llm.model,
            temperature: 0,
            ...(llm.maxTokens ? { max_tokens: llm.maxTokens } : {}),
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: `${SYSTEM_PROMPT}\nToday is ${now().toISOString().slice(0, 10)}.` },
              { role: "user", content: JSON.stringify({ title: item.title, summary: item.summary ?? "", url: item.url ?? null, publishedAt: item.publishedAt ?? null }) },
            ],
          }),
        });
        if (!res.ok) return [];
        const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return sanitizeCatalysts(JSON.parse(body.choices?.[0]?.message?.content ?? ""), now().toISOString().slice(0, 10));
      } catch (err) {
        console.error(`[catalyst-extract] ${errorMessage(err)}`);
        return [];
      }
    },
  };
}
