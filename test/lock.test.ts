import { describe, expect, it, vi } from "vitest";
import { createSyncLock } from "../src/lock.js";

describe("createSyncLock", () => {
  it("skips a concurrent run with the same name", async () => {
    const logs: string[] = [];
    const lock = createSyncLock((m) => logs.push(m));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = vi.fn(() => gate.then(() => "done"));

    const first = lock.run("sync", fn);
    const second = await lock.run("sync", fn);
    expect(second).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(logs).toContain("sync already running; skipped");

    release();
    expect(await first).toBe("done");
  });

  it("does not block runs with different names", async () => {
    const lock = createSyncLock();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = lock.run("a", () => gate);
    const b = lock.run("b", async () => "b-done");
    expect(await b).toBe("b-done");
    release();
    expect(await a).toBeUndefined();
  });

  it("releases the lock after a rejection", async () => {
    const lock = createSyncLock();
    await expect(lock.run("sync", async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    const fn = vi.fn(async () => "ok");
    expect(await lock.run("sync", fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("isRunning reflects the running set", async () => {
    const lock = createSyncLock();
    expect(lock.isRunning("sync")).toBe(false);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = lock.run("sync", () => gate);
    expect(lock.isRunning("sync")).toBe(true);
    expect(lock.isRunning("other")).toBe(false);
    release();
    await first;
    expect(lock.isRunning("sync")).toBe(false);
  });

  it("stats() counts skips per name without touching other names", async () => {
    const lock = createSyncLock();
    expect(lock.stats()).toEqual({});

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = lock.run("a", () => gate);

    await lock.run("a", async () => "skipped-1");
    await lock.run("a", async () => "skipped-2");
    await lock.run("b", async () => "b-done");

    const stats = lock.stats();
    expect(stats["a"]!.skips).toBe(2);
    expect(stats["a"]!.lastSkipAt).toEqual(expect.any(String));
    expect(new Date(stats["a"]!.lastSkipAt!).getTime()).not.toBeNaN();
    expect(stats["b"]).toBeUndefined();

    release();
    await first;
    expect(lock.stats()["a"]!.skips).toBe(2);
  });
});
