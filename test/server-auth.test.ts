import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSyncLock } from "../src/lock.js";
import { resetFrSyncReportForTests, syncFederalRegister } from "../src/catalysts/federal-register.js";
import { buildServer, frAlertFrom, isLoopbackHost } from "../src/server.js";
import type { FrSyncReport } from "../src/catalysts/federal-register.js";
import { deps, memoryStore } from "./helpers.js";

let app: Awaited<ReturnType<typeof buildServer>>;
const KEY = "secret-key";

beforeAll(async () => {
  process.env.CATALYST_API_KEY = KEY;
  const store = await memoryStore();
  app = buildServer(store, deps(store));
  await app.ready();
});
afterAll(async () => {
  delete process.env.CATALYST_API_KEY;
  await app.close();
});

describe("API key auth", () => {
  it("leaves GET requests public", async () => {
    expect((await app.inject({ method: "GET", url: "/themes" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/events" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/catalysts" })).statusCode).toBe(200);
    expect((await app.inject({ method: "HEAD", url: "/themes" })).statusCode).toBe(200);
  });

  it("returns 401 for mutations without the key", async () => {
    expect((await app.inject({ method: "POST", url: "/themes", payload: { name: "x" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/themes", payload: { name: "x" }, headers: { "x-api-key": "wrong" } })).statusCode).toBe(401);
  });

  it("returns 201 for mutations with the correct key", async () => {
    const res = await app.inject({ method: "POST", url: "/themes", payload: { name: "test-theme" }, headers: { "x-api-key": KEY } });
    expect(res.statusCode).toBe(201);
  });

  it("returns 401 for a wrong key of the same length", async () => {
    const res = await app.inject({ method: "POST", url: "/themes", payload: { name: "x" }, headers: { "x-api-key": "xxxxxxxxxx".slice(0, KEY.length) } });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for a wrong key of a different length", async () => {
    const res = await app.inject({ method: "POST", url: "/themes", payload: { name: "x" }, headers: { "x-api-key": "short" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("production requires CATALYST_API_KEY", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalKey = process.env.CATALYST_API_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalKey === undefined) delete process.env.CATALYST_API_KEY;
    else process.env.CATALYST_API_KEY = originalKey;
  });

  it("throws when unset in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CATALYST_API_KEY;
    const store = await memoryStore();
    expect(() => buildServer(store, deps(store))).toThrow("CATALYST_API_KEY must be set in production");
  });

  it("throws when empty in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CATALYST_API_KEY = "   ";
    const store = await memoryStore();
    expect(() => buildServer(store, deps(store))).toThrow("CATALYST_API_KEY must be set in production");
  });

  it("does not throw in production with a key", async () => {
    process.env.NODE_ENV = "production";
    process.env.CATALYST_API_KEY = KEY;
    const store = await memoryStore();
    const prod = buildServer(store, deps(store));
    await prod.ready();
    await prod.close();
  });
});

describe("host key requirement and lock integration", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalKey = process.env.CATALYST_API_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalKey === undefined) delete process.env.CATALYST_API_KEY;
    else process.env.CATALYST_API_KEY = originalKey;
  });

  it("throws without a key on a non-loopback host", async () => {
    process.env.NODE_ENV = originalEnv;
    delete process.env.CATALYST_API_KEY;
    const store = await memoryStore();
    expect(() => buildServer(store, deps(store), { host: "0.0.0.0" })).toThrow(
      "CATALYST_API_KEY must be set in production or when listening on a non-loopback host",
    );
  });

  it.each(["127.0.0.1", "::1", "localhost"])("does not throw for loopback host %s without a key", async (host) => {
    process.env.NODE_ENV = originalEnv;
    delete process.env.CATALYST_API_KEY;
    const store = await memoryStore();
    const app = buildServer(store, deps(store), { host });
    await app.ready();
    await app.close();
  });

  it("classifies loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("  LocalHost  ")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(isLoopbackHost("::")).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
  });

  it("reports lock skips in /health", async () => {
    const store = await memoryStore();
    const lock = createSyncLock();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = lock.run("source-poll", () => gate);
    await lock.run("source-poll", async () => "skipped");
    const app = buildServer(store, deps(store), { lock });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; locks: Record<string, { skips: number; lastSkipAt: string | null }> };
    expect(body.ok).toBe(true);
    expect(body.locks["source-poll"]!.skips).toBe(1);
    release();
    await held;
    await app.close();
  });

  it("returns 409 when the source-poll lock is held", async () => {
    const store = await memoryStore();
    const source = await store.createSource({ type: "push", name: "held-source", config: {} });
    const lock = createSyncLock();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = lock.run("source-poll", () => gate);
    const app = buildServer(store, deps(store), { lock });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/sources/${source.id}/run`,
      headers: { "x-api-key": process.env.CATALYST_API_KEY ?? KEY },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "source_poll_running" });
    await app.close();
    release();
    await held;
  });

  it("manual run goes through the lock", async () => {
    const store = await memoryStore();
    const source = await store.createSource({ type: "push", name: "manual-source", config: {} });
    const lock = createSyncLock();
    const app = buildServer(store, deps(store), { lock });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/sources/${source.id}/run`,
      headers: { "x-api-key": process.env.CATALYST_API_KEY ?? KEY },
    });
    expect(res.statusCode).not.toBe(409);
    expect(res.statusCode).not.toBe(404);
    const stats = lock.stats()["source-poll"]!;
    expect(typeof stats.lastRunAt).toBe("string");
    expect(stats.lastRunAt).not.toBeNull();
    expect(typeof stats.lastDurationMs).toBe("number");
    await app.close();
  });

  it("counts early 409s as skips and reports them in /health", async () => {
    const store = await memoryStore();
    const source = await store.createSource({ type: "push", name: "skip-source", config: {} });
    const lock = createSyncLock();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = lock.run("source-poll", () => gate);
    const app = buildServer(store, deps(store), { lock });
    await app.ready();
    const headers = { "x-api-key": process.env.CATALYST_API_KEY ?? KEY };
    expect((await app.inject({ method: "POST", url: `/sources/${source.id}/run`, headers })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/sources/${source.id}/run`, headers })).statusCode).toBe(409);
    expect(lock.stats()["source-poll"]!.skips).toBe(2);
    expect(lock.stats()["source-poll"]!.held).toBe(true);
    release();
    await held;
    const body = (await app.inject({ method: "GET", url: "/health" })).json() as {
      locks: Record<string, { held: boolean; lastRunAt: string | null; lastDurationMs: number | null }>;
    };
    expect(body.locks["source-poll"]!.held).toBe(false);
    expect(body.locks["source-poll"]!.lastRunAt).not.toBeNull();
    expect(typeof body.locks["source-poll"]!.lastDurationMs).toBe("number");
    await app.close();
  });

  it("/health shows lastError for a failed source run and lastOk for a successful one", async () => {
    const store = await memoryStore();
    const lock = createSyncLock();
    const app = buildServer(store, deps(store), { lock }); // fakeFetch({}) -> 404 for any url
    await app.ready();
    const headers = { "x-api-key": process.env.CATALYST_API_KEY ?? KEY };
    const json = await store.createSource({ type: "json", name: "failing", config: { url: "https://x.test/api", fields: { title: "title" } } });
    const res = await app.inject({ method: "POST", url: `/sources/${json.id}/run`, headers });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { error: string }).error).toBeTruthy();
    const afterFail = (await app.inject({ method: "GET", url: "/health" })).json() as {
      locks: Record<string, { lastError: string | null; lastOk: string | null }>;
    };
    expect(afterFail.locks["source-poll"]!.lastError).toBeTruthy();
    expect(afterFail.locks["source-poll"]!.lastOk).toBeNull();

    const push = await store.createSource({ type: "push", name: "succeeding", config: {} });
    await app.inject({ method: "POST", url: `/sources/${push.id}/run`, headers });
    const afterOk = (await app.inject({ method: "GET", url: "/health" })).json() as {
      locks: Record<string, { lastError: string | null; lastOk: string | null }>;
    };
    expect(afterOk.locks["source-poll"]!.lastOk).toEqual(expect.any(String));
    expect(afterOk.locks["source-poll"]!.lastError).toBeNull();
    await app.close();
  });
});

describe("frAlertFrom", () => {
  const report = (presidentialDrops: number) => ({ presidentialDrops }) as FrSyncReport;
  it("flags degraded when presidential drops exist, null otherwise", () => {
    expect(frAlertFrom(report(2))).toEqual({ degraded: true, reason: "presidential frDrops", count: 2 });
    expect(frAlertFrom(report(0))).toBeNull();
    expect(frAlertFrom(null)).toBeNull();
  });
});
