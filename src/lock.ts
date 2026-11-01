export function createSyncLock(log?: (m: string) => void): {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T | undefined>;
  isRunning: (name: string) => boolean;
  recordSkip: (name: string) => void;
  stats: () => Record<string, { skips: number; lastSkipAt: string | null; held: boolean; lastRunAt: string | null; lastDurationMs: number | null }>;
} {
  const running = new Set<string>();
  const statsMap = new Map<string, { skips: number; lastSkipAt: string | null; lastRunAt: string | null; lastDurationMs: number | null }>();
  const entry = (name: string) => {
    let s = statsMap.get(name);
    if (!s) {
      s = { skips: 0, lastSkipAt: null, lastRunAt: null, lastDurationMs: null };
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
    async run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
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
        return await fn();
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
