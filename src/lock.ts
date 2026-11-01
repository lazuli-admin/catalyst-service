export function createSyncLock(log?: (m: string) => void): {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T | undefined>;
  isRunning: (name: string) => boolean;
  stats: () => Record<string, { skips: number; lastSkipAt: string | null }>;
} {
  const running = new Set<string>();
  const skips = new Map<string, { skips: number; lastSkipAt: string | null }>();
  return {
    async run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
      if (running.has(name)) {
        const s = skips.get(name) ?? { skips: 0, lastSkipAt: null };
        s.skips += 1;
        s.lastSkipAt = new Date().toISOString();
        skips.set(name, s);
        log?.(`${name} already running; skipped`);
        return undefined;
      }
      running.add(name);
      try {
        return await fn();
      } finally {
        running.delete(name);
      }
    },
    isRunning: (name) => running.has(name),
    stats: () => Object.fromEntries(skips),
  };
}

export type SyncLock = ReturnType<typeof createSyncLock>;
