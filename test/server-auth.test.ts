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
  it("leaves GET requests public", async () => {
    expect((await app.inject({ method: "GET", url: "/themes" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
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
});
