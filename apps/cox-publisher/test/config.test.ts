import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, assertReady } from "../src/config.ts";

async function withConfig(change: Record<string, unknown>, check: (path: string) => Promise<void>) {
  const template = JSON.parse(await readFile(new URL("../config/dev.json", import.meta.url), "utf8")) as Record<string, unknown>;
  const directory = await mkdtemp(join(tmpdir(), "cox-publisher-config-"));
  const path = join(directory, "config.json");
  try {
    await writeFile(path, JSON.stringify({ ...template, ...change }));
    await check(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("disabled configuration loads without activation identities", async () => {
  await withConfig({}, async path => {
    const config = await loadConfig(path);
    assert.equal(config.enabled, false);
    assert.equal(config.poolId, null);
    assert.throws(() => assertReady(config), /PublisherNotConfigured/);
  });
});

test("enabled configuration requires every activation identity", async () => {
  await withConfig({ enabled: true }, async path => { await assert.rejects(loadConfig(path), /PublisherNotConfigured/); });
  await withConfig({ enabled: true, poolId: "0", methodologyDigest: "a".repeat(64), origin: "1800000000" }, async path => {
    const config = await loadConfig(path);
    assertReady(config);
    assert.equal(config.origin, "1800000000");
  });
});

test("canonical roster may only drop feed-check failures", async () => {
  await withConfig({ assets: ["BTC", "SOL"] }, async path => { assert.deepEqual((await loadConfig(path)).assets, ["BTC", "SOL"]); });
  for (const assets of [["SOL", "BTC"], ["BTC", "BTC"], ["BTC", "UNKNOWN"], ["BTC"]]) {
    await withConfig({ assets }, async path => { await assert.rejects(loadConfig(path), /InvalidPublisherConfig:assets/); });
  }
});

test("configuration rejects unsafe settings and identity changes", async () => {
  const invalid: Record<string, unknown>[] = [
    { enabled: "true" }, { bybit: 1 }, { poolId: "01" }, { poolId: "18446744073709551616" },
    { origin: "1800000001" }, { origin: "0" }, { origin: "1e9" }, { methodologyDigest: "0".repeat(64) },
    { methodologyDigest: "A".repeat(64) }, { runtimeAuthority: "wrong" }, { genesisHash: "wrong" },
    { signerNetwork: "wrong" }, { keyVersion: "wrong" }, { wallet: "/tmp/private.json" },
    { computeUnitLimit: 1_400_001 }, { computeUnitLimit: 0 }, { computeUnitPriceMicroLamports: 1_001 },
    { pollMs: 99 }, { pollMs: 30_001 }, { retryMaxMs: 30_001 }, { statePath: "state.json" },
    { rpcUrl: "http://public.example.com" }, { signerUrl: "https://user:secret@example.com" },
    { signerUrl: "https://untrusted.example.com" }, { signerAudience: "https://untrusted.example.com" },
    { signerUrl: "https://untrusted.example.com", signerAudience: "https://untrusted.example.com" },
    { archiveUrl: "file:///tmp/archive" }, { signerAudience: "https://example.com?token=secret" },
  ];
  for (const change of invalid) await withConfig(change, async path => { await assert.rejects(loadConfig(path)); });
});

test("private runtime settings pin a separate signer endpoint and audience", async () => {
  const previousUrl = process.env.COX_SIGNER_URL;
  const previousAudience = process.env.COX_SIGNER_AUDIENCE;
  process.env.COX_SIGNER_URL = "https://private-signer.example.com";
  process.env.COX_SIGNER_AUDIENCE = "https://private-audience.example.com";
  try {
    await withConfig({ signerUrl: process.env.COX_SIGNER_URL, signerAudience: process.env.COX_SIGNER_AUDIENCE }, async path => {
      const config = await loadConfig(path);
      assert.equal(config.signerAudience, process.env.COX_SIGNER_AUDIENCE);
    });
    await withConfig({ signerUrl: "https://other.example.com", signerAudience: process.env.COX_SIGNER_AUDIENCE }, async path => {
      await assert.rejects(loadConfig(path), /InvalidPublisherConfig:signerUrl/);
    });
    await withConfig({ signerUrl: process.env.COX_SIGNER_URL, signerAudience: "https://other.example.com" }, async path => {
      await assert.rejects(loadConfig(path), /InvalidPublisherConfig:signerAudience/);
    });
  } finally {
    if (previousUrl === undefined) delete process.env.COX_SIGNER_URL;
    else process.env.COX_SIGNER_URL = previousUrl;
    if (previousAudience === undefined) delete process.env.COX_SIGNER_AUDIENCE;
    else process.env.COX_SIGNER_AUDIENCE = previousAudience;
  }
});
