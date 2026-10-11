import { describe, expect, it } from "vitest";
import { handle, type Env } from "../src/worker.js";

const TOKEN = "a".repeat(40);
const OTHER = "b".repeat(40);
const env: Env = { UPSTREAM_URLS: "https://primary.example/?api-key=k https://fallback.example", ACCESS_TOKENS: `${TOKEN} ${OTHER}` };
const call = (method: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, method });

function request(path: string, body: string | null = call("getSlot"), init: RequestInit = {}) {
  return new Request(`https://proxy.example${path}`, { method: "POST", headers: { "content-type": "application/json" }, body, ...init });
}

function upstream(statuses: Record<string, number | Error>) {
  const seen: { url: string; body: string }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const key = String(url);
    seen.push({ url: key, body: new TextDecoder().decode(init!.body as ArrayBuffer) });
    const outcome = statuses[key] ?? 200;
    if (outcome instanceof Error) throw outcome;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: key }), { status: outcome, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { seen, fetcher };
}

describe("RPC proxy worker", () => {
  it("forwards a permitted call unchanged to the first upstream", async () => {
    const { seen, fetcher } = upstream({});
    const response = await handle(request(`/${TOKEN}`), env, fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-rpc-upstream")).toBe("0");
    expect(seen).toEqual([{ url: "https://primary.example/?api-key=k", body: call("getSlot") }]);
  });

  it("fails over on rate limits, server errors and network errors, and reports when all fail", async () => {
    const limited = upstream({ "https://primary.example/?api-key=k": 429 });
    const response = await handle(request(`/${OTHER}`), env, limited.fetcher);
    expect(response.headers.get("x-rpc-upstream")).toBe("1");
    expect(limited.seen.map((s) => s.url)).toEqual(["https://primary.example/?api-key=k", "https://fallback.example"]);
    const down = upstream({ "https://primary.example/?api-key=k": new Error("timeout"), "https://fallback.example": 503 });
    const failed = await handle(request(`/${TOKEN}`), env, down.fetcher);
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("primary.example");
  });

  it("passes client errors through instead of failing over", async () => {
    const { seen, fetcher } = upstream({ "https://primary.example/?api-key=k": 400 });
    expect((await handle(request(`/${TOKEN}`), env, fetcher)).status).toBe(400);
    expect(seen).toHaveLength(1);
  });

  it("refuses unknown tokens, other methods, wrong verbs, oversized and malformed bodies", async () => {
    const { seen, fetcher } = upstream({});
    expect((await handle(request(`/${"c".repeat(40)}`), env, fetcher)).status).toBe(401);
    expect((await handle(request("/"), env, fetcher)).status).toBe(401);
    expect((await handle(request(`/${TOKEN}/extra`), env, fetcher)).status).toBe(401);
    expect((await handle(request(`/${TOKEN}`, null, { method: "GET" }), env, fetcher)).status).toBe(405);
    expect((await handle(request(`/${TOKEN}`, call("requestAirdrop")), env, fetcher)).status).toBe(403);
    expect((await handle(request(`/${TOKEN}`, JSON.stringify(Array.from({ length: 21 }, () => JSON.parse(call("getSlot"))))), env, fetcher)).status).toBe(403);
    expect((await handle(request(`/${TOKEN}`, "{"), env, fetcher)).status).toBe(400);
    expect((await handle(request(`/${TOKEN}`, "x".repeat(70_000)), env, fetcher)).status).toBe(413);
    expect((await handle(request(`/${TOKEN}`, call("getSlot"), { headers: { "content-type": "text/plain" } }), env, fetcher)).status).toBe(415);
    expect(seen).toHaveLength(0);
  });

  it("accepts a batch of permitted calls and refuses to run unconfigured", async () => {
    const { fetcher } = upstream({});
    const batch = JSON.stringify([JSON.parse(call("getSlot")), JSON.parse(call("getMultipleAccounts"))]);
    expect((await handle(request(`/${TOKEN}`, batch), env, fetcher)).status).toBe(200);
    expect((await handle(request(`/${TOKEN}`), { UPSTREAM_URLS: "", ACCESS_TOKENS: TOKEN }, fetcher)).status).toBe(503);
    expect((await handle(request(`/${TOKEN}`), { UPSTREAM_URLS: "http://insecure.example", ACCESS_TOKENS: TOKEN }, fetcher)).status).toBe(503);
  });
});
