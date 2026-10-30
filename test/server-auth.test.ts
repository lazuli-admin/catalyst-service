import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
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
  it("returns 401 without or with a wrong key", async () => {
    expect((await app.inject({ method: "GET", url: "/themes" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/themes", headers: { "x-api-key": "wrong" } })).statusCode).toBe(401);
  });

  it("returns 200 with the correct key", async () => {
    const res = await app.inject({ method: "GET", url: "/themes", headers: { "x-api-key": KEY } });
    expect(res.statusCode).toBe(200);
  });

  it("leaves /health open", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
