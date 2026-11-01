// Verified static policy calendar maintained in data/policy-events.json (hand-checked dates + source links). No LLM.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Store } from "../db.js";
import type { Catalyst } from "../types.js";
import { errorMessage } from "../util.js";

/** FR document number, e.g. 2026-16400. */
export const FR_DOC_NUMBER_RE = /\b(\d{4}-\d{5})\b/g;

export type FrNumberedEvent = Pick<PolicyEvent, "sourceUrl"> & { frDocumentNumber?: string; documentNumber?: string; relatedFrDocumentNumbers?: string[] };

/** FR document numbers referenced by curated events: from the /documents/YYYY/MM/DD/<doc-number>/ URL, or an explicit field. Pure. */
export function frDocNumbersFromEvents(events: FrNumberedEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    for (const field of [e.frDocumentNumber, e.documentNumber]) {
      // String.match resets the global regex's lastIndex, so repeated calls stay safe.
      const m = typeof field === "string" ? field.match(FR_DOC_NUMBER_RE) : null;
      if (m) out.add(m[0]);
    }
    for (const field of e.relatedFrDocumentNumbers ?? []) {
      const m = typeof field === "string" ? field.match(FR_DOC_NUMBER_RE) : null;
      if (m) out.add(m[0]);
    }
    if (e.sourceUrl.includes("federalregister.gov")) {
      for (const m of e.sourceUrl.matchAll(FR_DOC_NUMBER_RE)) out.add(m[1]!);
    }
  }
  return out;
}

/** FR document numbers cited by the curated policy file, so FR sync can skip them (no duplicate rows). Throws on read/parse errors (fail closed). */
export async function curatedFrDocNumbers(file?: string): Promise<Set<string>> {
  const f = file ?? path.join(process.cwd(), "data", "policy-events.json");
  const body = JSON.parse(await readFile(f, "utf8")) as { events?: FrNumberedEvent[] };
  return frDocNumbersFromEvents(body.events ?? []);
}

function horizonEnd(today: string, horizonDays: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10); // clock-guard: pure-date
}

interface PolicyEvent {
  id: string;
  date: string;
  dateEnd?: string;
  precision: Catalyst["datePrecision"];
  title: string;
  kind: Catalyst["kind"];
  sourceUrl: string;
  themes: string[];
  affectedTickers: string[];
}

/** Upsert verified policy events overlapping [today, today+horizonDays]; drop rows whose id left the file. Never throws. */
export async function syncPolicyEvents(
  store: Pick<Store, "upsertCatalyst" | "purgeByKeyPrefixExcept">,
  opts: { today: string; horizonDays: number; file?: string; log?: (m: string) => void },
): Promise<void> {
  try {
    const file = opts.file ?? path.join(process.cwd(), "data", "policy-events.json");
    const body = JSON.parse(await readFile(file, "utf8")) as { events?: PolicyEvent[] };
    const end = horizonEnd(opts.today, opts.horizonDays);
    const keepKeys: string[] = [];
    for (const e of body.events ?? []) {
      const dateEnd = e.dateEnd ?? e.date;
      if (dateEnd < opts.today || e.date > end) continue;
      const dedupeKey = `policy:${e.id}`;
      keepKeys.push(dedupeKey);
      await store.upsertCatalyst({
        ticker: null,
        title: e.title,
        kind: e.kind,
        status: "scheduled",
        dateStart: e.date,
        dateEnd,
        datePrecision: e.precision,
        confidence: 0.95,
        themes: e.themes,
        affectedTickers: e.affectedTickers,
        sourceTier: 1,
        sourceUrl: e.sourceUrl,
        observationId: null,
        dedupeKey,
      });
    }
    await store.purgeByKeyPrefixExcept("policy:", keepKeys);
  } catch (err) {
    (opts.log ?? (() => {}))(`policy events failed: ${errorMessage(err)}`);
  }
}
