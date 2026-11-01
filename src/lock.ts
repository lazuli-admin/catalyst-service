/** Redact query strings and credentials from an error message, truncated to 200 chars. */
export function sanitizeError(msg: string): string {
  const redacted = msg
    .replace(/\?[^\s]*/g, "?<redacted>")
    .replace(/(bearer\s+)\S+/gi, "$1<redacted>")
    .replace(/\b(key|token|secret|password|apikey|api_key)=\S+/gi, "$1=<redacted>");
  return redacted.length > 200 ? redacted.slice(0, 200) : redacted;
}

export function createSyncLock(log?: (m: string) => void): {
  run: <T>(name: string, fn: () => Promise<T>, check?: (result: T) => string | null) => Promise<T | undefined>;
  isRunning: (name: string) => boolean;
  recordSkip: (name: string) => void;
  stats: () => Record<string, { skips: number; lastSkipAt: string | null; held: boolean; lastRunAt: string | null; lastDurationMs: number | null; lastOk: string | null; lastError: string | null }>;
} {
  const running = new Set<string>();
  const statsMap = new Map<string, { skips: number; lastSkipAt: string | null; lastRunAt: string | null; lastDurationMs: number | null; lastOk: string | null; lastError: string | null }>();
  const entry = (name: string) => {
    let s = statsMap.get(name);
    if (!s) {
      s = { skips: 0, lastSkipAt: null, lastRunAt: null, lastDurationMs: null, lastOk: null, lastError: null };
      statsMap.set(name, s);
    }
    return s;
  };
  const recordSkip = (name: string): void => {
    const s = entry(name);
    s.skips += 1;
    s.lastSkipAt = new Date().toISOString();
  };
  return {
    async run<T>(name: string, fn: () => Promise<T>, check?: (result: T) => string | null): Promise<T | undefined> {
      if (running.has(name)) {
        recordSkip(name);
        log?.(`${name} already running; skipped`);
        return undefined;
      }
      running.add(name);
      const start = new Date();
      entry(name).lastRunAt = start.toISOString();
      const t0 = Date.now();
      try {
        const result = await fn();
        const msg = check?.(result) ?? null;
        const s = entry(name);
        if (msg) s.lastError = sanitizeError(msg);
        else {
          s.lastOk = new Date().toISOString();
          s.lastError = null;
        }
        return result;
      } catch (err) {
        entry(name).lastError = sanitizeError(String((err as { message?: string }).message ?? err));
        throw err;
      } finally {
        running.delete(name);
        entry(name).lastDurationMs = Date.now() - t0;
      }
    },
    isRunning: (name) => running.has(name),
    recordSkip,
    stats: () =>
      Object.fromEntries(
        [...statsMap.entries()].map(([name, s]) => [name, { ...s, held: running.has(name) }]),
      ),
  };
}

export type SyncLock = ReturnType<typeof createSyncLock>;
