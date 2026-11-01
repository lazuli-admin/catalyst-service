export function createSyncLock(log?: (m: string) => void): {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T | undefined>;
} {
  const running = new Set<string>();
  return {
    async run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
      if (running.has(name)) {
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
  };
}
