import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkGenesis, failoverConnection, parseRpcUrls } from "../src/cox/rpc.js";

const servers: Server[] = [];

async function endpoint(handler: (method: string) => { status: number; result?: unknown }): Promise<{ url: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { method, id } = JSON.parse(body) as { method: string; id: unknown };
      calls.push(method);
      const { status, result } = handler(method);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/?api-key=secret`, calls };
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe("RPC failover", () => {
  it("parses an ordered https list and refuses plain http without echoing the key", () => {
    expect(parseRpcUrls(" https://a.example/?api-key=k1\nhttps://b.example ", "X")).toEqual(["https://a.example/?api-key=k1", "https://b.example"]);
    expect(() => parseRpcUrls("", "X")).toThrow("at least one");
    expect(() => parseRpcUrls("http://a.example/?api-key=k1", "X")).toThrow(/non-https URL for a\.example$/);
  });

  it("moves to the next endpoint on a rate limit or server error and stays there", async () => {
    let primaryStatus = 429;
    const primary = await endpoint(() => ({ status: primaryStatus, result: "GENESIS" }));
    const fallback = await endpoint(() => ({ status: 200, result: "GENESIS" }));
    const switches: string[] = [];
    const connection = failoverConnection([primary.url, fallback.url], "finalized", (from, to) => switches.push(`${from}->${to}`));
    expect(await connection.getGenesisHash()).toBe("GENESIS");
    expect(await connection.getGenesisHash()).toBe("GENESIS");
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(2);
    expect(switches).toHaveLength(1);
    expect(switches[0]).not.toContain("secret");
    primaryStatus = 200;
    expect(await connection.getGenesisHash()).toBe("GENESIS");
    expect(primary.calls).toHaveLength(1);
  });

  it("fails when every endpoint fails", async () => {
    const a = await endpoint(() => ({ status: 503 }));
    const b = await endpoint(() => ({ status: 500 }));
    await expect(failoverConnection([a.url, b.url], "finalized").getGenesisHash()).rejects.toThrow(/returned HTTP 500/);
  });

  it("requires every endpoint to be on the expected network", async () => {
    const devnet = await endpoint(() => ({ status: 200, result: "DEVNET" }));
    const other = await endpoint(() => ({ status: 200, result: "MAINNET" }));
    await checkGenesis([devnet.url], "DEVNET");
    await expect(checkGenesis([devnet.url, other.url], "DEVNET")).rejects.toThrow("is not on the expected network");
  });
});
