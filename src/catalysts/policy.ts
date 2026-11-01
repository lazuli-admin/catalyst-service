// Verified static policy calendar maintained in data/policy-events.json (hand-checked dates + source links). No LLM.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Store } from "../db.js";
import type { Catalyst } from "../types.js";
import { errorMessage } from "../util.js";

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
