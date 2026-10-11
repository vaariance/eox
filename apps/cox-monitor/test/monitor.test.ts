import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ArchivedCutoff } from "../src/archive.js";
import { type ArchivedChange, type EvidenceSource, EvidenceUnavailable } from "../src/evidence-source.js";
import { ArchiveMonitor, type MonitorState, emptyMonitorState } from "../src/monitor.js";
import { MONITOR_SCHEMA, createMonitorServer } from "../src/server.js";
import { snapshotDigest } from "../src/wire.js";

const published = (
  JSON.parse(readFileSync(new URL("../../../packages/cox/fixtures/vectors.json", import.meta.url), "utf8")) as {
    wire: { snapshot: { cutoff: string; digest: string } };
  }
).wire.snapshot;

const BASE = Number(published.cutoff);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function minute(cutoff: number): ArchivedCutoff {
  const digest = snapshotDigest(BigInt(cutoff), ["BTC", "ETH"], [
    { assetId: "BTC", venue: 0, step: 1, candleStart: BigInt(cutoff - 60), priceE8: 10_000_000_000n, tradeAgeMinutes: 0 },
    { assetId: "ETH", venue: 0, step: 4, candleStart: BigInt(cutoff - 120), priceE8: 20_000_000_000n, tradeAgeMinutes: 1 },
  ]);
  const frames = sha(`frames ${cutoff}`);
  return {
    cutoff,
    snapshot: { digest, digestEncoding: "COX/WIRE/V1", admissible: true },
    assets: [
      {
        assetId: "BTC",
        position: 0,
        attempts: [{ step: 1, venue: "kraken", outcome: "trades", artifactDigest: frames }],
        price: { venue: "kraken", step: 1, candleStart: cutoff - 60, close: "100", usdtUsd: null, usdtArtifactDigest: null, priceE8: "10000000000", tradeAgeMinutes: 0, artifactDigest: frames, admissible: true, rejection: null },
      },
      {
        assetId: "ETH",
        position: 1,
        attempts: [
          { step: 1, venue: "kraken", outcome: "empty", artifactDigest: null },
          { step: 4, venue: "kraken", outcome: "trades", artifactDigest: frames },
        ],
        price: { venue: "kraken", step: 4, candleStart: cutoff - 120, close: "200", usdtUsd: null, usdtArtifactDigest: null, priceE8: "20000000000", tradeAgeMinutes: 1, artifactDigest: frames, admissible: true, rejection: null },
      },
    ],
    usdtUsd: { attempts: [] },
  };
}

class Archive implements EvidenceSource {
  readonly minutes: ArchivedCutoff[] = [];
  readonly missingArtifacts = new Set<string>();
  feedOverride = new Map<number, Partial<ArchivedChange>>();
  failCutoff: number | null = null;
  cutoffReads = 0;

  add(count: number): void {
    for (let index = 0; index < count; index += 1) this.minutes.push(minute(BASE + this.minutes.length * 60));
  }

  async changes(after: string | null, limit: number) {
    const start = after === null ? 0 : Number(after);
    const page = this.minutes.slice(start, start + limit);
    return {
      after: String(start + page.length),
      cutoffs: page.map((item) => ({ cutoff: item.cutoff, admissible: item.snapshot.admissible, snapshotDigest: item.snapshot.digest, ...this.feedOverride.get(item.cutoff) })),
    };
  }

  async cutoff(cutoff: number) {
    this.cutoffReads += 1;
    if (cutoff === this.failCutoff) throw new EvidenceUnavailable("evidence API answered HTTP 503");
    return this.minutes.find((item) => item.cutoff === cutoff) ?? null;
  }

  async hasArtifact(digest: string) {
    return !this.missingArtifacts.has(digest);
  }
}

function build(archive: Archive, state: MonitorState = emptyMonitorState(), options: { pageSize?: number; keep?: number } = {}) {
  const saved: MonitorState[] = [];
  const monitor = new ArchiveMonitor({ source: archive, state, save: async (next) => void saved.push(structuredClone(next)), now: () => 1_000, ...options });
  return { monitor, saved };
}

describe("archive monitor loop", () => {
  it("checks every archived cutoff once, across pages, and saves its place", async () => {
    const archive = new Archive();
    archive.add(5);
    const { monitor, saved } = build(archive, emptyMonitorState(), { pageSize: 2 });
    expect(await monitor.tick()).toEqual({ checked: 5, mismatches: 0 });
    expect(monitor.state.cursor).toBe("5");
    expect(monitor.state.verdicts.map((verdict) => verdict.verdict)).toEqual(["match", "match", "match", "match", "match"]);
    expect(monitor.latest()?.snapshotDigest).toBe(archive.minutes[4]!.snapshot.digest);
    expect(saved[saved.length - 1]!.cursor).toBe("5");
    expect(await monitor.tick()).toEqual({ checked: 0, mismatches: 0 });
    expect(archive.cutoffReads).toBe(5);
  });

  it("reproduces the published snapshot digest for the published cutoff", async () => {
    const archive = new Archive();
    archive.add(1);
    const { monitor } = build(archive);
    await monitor.tick();
    expect(monitor.find(BASE)?.snapshotDigest).toBe(published.digest);
  });

  it("resumes from saved state after a restart without rechecking", async () => {
    const archive = new Archive();
    archive.add(3);
    const first = build(archive);
    await first.monitor.tick();
    archive.add(2);
    const second = build(archive, structuredClone(first.saved[first.saved.length - 1]!));
    expect(await second.monitor.tick()).toEqual({ checked: 2, mismatches: 0 });
    expect(second.monitor.state.checked).toBe(5);
    expect(archive.cutoffReads).toBe(5);
  });

  it("does not move past a cutoff it could not read, and does not count it twice on retry", async () => {
    const archive = new Archive();
    archive.add(3);
    archive.failCutoff = BASE + 60;
    const { monitor } = build(archive);
    await expect(monitor.tick()).rejects.toBeInstanceOf(EvidenceUnavailable);
    expect(monitor.state.cursor).toBeNull();
    archive.failCutoff = null;
    expect(await monitor.tick()).toEqual({ checked: 3, mismatches: 0 });
    expect(monitor.state.checked).toBe(3);
    expect(monitor.state.cursor).toBe("3");
  });

  it("reports a tampered price, a missing artifact and a feed that disagrees with the archive", async () => {
    const archive = new Archive();
    archive.add(4);
    archive.minutes[0]!.assets[0]!.price!.priceE8 = "10000000001";
    archive.missingArtifacts.add(archive.minutes[1]!.assets[0]!.price!.artifactDigest);
    archive.feedOverride.set(BASE + 120, { snapshotDigest: "ab".repeat(32) });
    const { monitor } = build(archive);
    expect(await monitor.tick()).toEqual({ checked: 4, mismatches: 3 });
    expect(monitor.find(BASE)!.findings.some((finding) => finding.includes("is not the close 100"))).toBe(true);
    expect(monitor.find(BASE + 60)!.findings.some((finding) => finding.endsWith("is not in the archive"))).toBe(true);
    expect(monitor.find(BASE + 120)!.findings).toEqual(["the change feed and the archived cutoff disagree about the snapshot"]);
    expect(monitor.find(BASE + 180)!.verdict).toBe("match");
    expect(monitor.state.mismatches).toBe(3);
  });

  it("keeps skipped and inadmissible cutoffs apart from mismatches", async () => {
    const archive = new Archive();
    archive.add(2);
    archive.minutes[0]!.snapshot.digestEncoding = null;
    archive.minutes[1]!.snapshot = { digest: null, digestEncoding: null, admissible: false };
    const { monitor } = build(archive);
    expect(await monitor.tick()).toEqual({ checked: 2, mismatches: 0 });
    expect(monitor.state.verdicts.map((verdict) => verdict.verdict)).toEqual(["skipped", "inadmissible"]);
  });

  it("holds only the most recent verdicts", async () => {
    const archive = new Archive();
    archive.add(6);
    const { monitor } = build(archive, emptyMonitorState(), { keep: 4 });
    await monitor.tick();
    expect(monitor.state.verdicts.map((verdict) => verdict.cutoff)).toEqual([BASE + 120, BASE + 180, BASE + 240, BASE + 300]);
    expect(monitor.state.checked).toBe(6);
  });
});

describe("verdict server", () => {
  let close: (() => void) | null = null;
  afterEach(() => close?.());

  async function serve(monitor: ArchiveMonitor): Promise<string> {
    const server = createMonitorServer(monitor);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    close = () => server.close();
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("answers 404 before anything has been checked", async () => {
    const { monitor } = build(new Archive());
    const base = await serve(monitor);
    const response = await fetch(`${base}/v1/verdicts/latest`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ schema: MONITOR_SCHEMA, error: { code: "NO_VERDICT", message: "nothing has been checked yet" } });
  });

  it("serves the latest verdict, one by cutoff, a recent list and health", async () => {
    const archive = new Archive();
    archive.add(3);
    archive.minutes[1]!.assets[0]!.price!.priceE8 = "1";
    const { monitor } = build(archive);
    await monitor.tick();
    const base = await serve(monitor);

    const latest = (await (await fetch(`${base}/v1/verdicts/latest`)).json()) as { schema: string; verdict: { scope: string; cutoff: number; verdict: string } };
    expect(latest.schema).toBe(MONITOR_SCHEMA);
    expect(latest.verdict).toMatchObject({ scope: "archive", cutoff: BASE + 120, verdict: "match", venues: "pending" });

    const one = (await (await fetch(`${base}/v1/verdicts/${BASE + 60}`)).json()) as { verdict: { verdict: string; findings: string[] } };
    expect(one.verdict.verdict).toBe("mismatch");
    expect(one.verdict.findings.length).toBeGreaterThan(0);

    const list = (await (await fetch(`${base}/v1/verdicts?limit=2`)).json()) as { verdicts: { cutoff: number }[] };
    expect(list.verdicts.map((verdict) => verdict.cutoff)).toEqual([BASE + 120, BASE + 60]);

    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ schema: MONITOR_SCHEMA, checked: 3, mismatches: 1, started: true, latestCutoff: BASE + 120 });
  });

  it("refuses writes, unknown routes, unknown cutoffs and a bad limit", async () => {
    const archive = new Archive();
    archive.add(1);
    const { monitor } = build(archive);
    await monitor.tick();
    const base = await serve(monitor);
    expect((await fetch(`${base}/v1/verdicts/latest`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/v1/pause`)).status).toBe(404);
    expect((await fetch(`${base}/v1/verdicts/${BASE + 6000}`)).status).toBe(404);
    expect((await fetch(`${base}/v1/verdicts?limit=0`)).status).toBe(400);
  });
});
