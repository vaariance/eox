import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MonitorMathError } from "../src/arithmetic.js";
import { type ArchivedAsset, type ArchivedCutoff, artifactDigests, checkArchivedCutoff, checkArtifacts } from "../src/archive.js";
import { usdToE8, usdtToE8 } from "../src/decimal.js";
import { EvidenceUnavailable, httpEvidenceSource } from "../src/evidence-source.js";

const wire = (
  JSON.parse(readFileSync(new URL("../../../packages/cox/fixtures/vectors.json", import.meta.url), "utf8")) as {
    wire: { snapshot: { cutoff: string; digest: string } };
  }
).wire;

const CUTOFF = Number(wire.snapshot.cutoff);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const artifact = { btc: sha("btc frames"), ethEmpty: sha("eth empty"), ethCarried: sha("eth carried") };

function archived(): ArchivedCutoff {
  return {
    cutoff: CUTOFF,
    snapshot: { digest: wire.snapshot.digest, digestEncoding: "COX/WIRE/V1", admissible: true },
    assets: [
      {
        assetId: "BTC",
        position: 0,
        attempts: [{ step: 1, venue: "kraken", outcome: "trades", artifactDigest: artifact.btc }],
        price: { venue: "kraken", step: 1, candleStart: CUTOFF - 60, close: "100", usdtUsd: null, usdtArtifactDigest: null, priceE8: "10000000000", tradeAgeMinutes: 0, artifactDigest: artifact.btc, admissible: true, rejection: null },
      },
      {
        assetId: "ETH",
        position: 1,
        attempts: [
          { step: 1, venue: "kraken", outcome: "empty", artifactDigest: artifact.ethEmpty },
          { step: 2, venue: "coinbase", outcome: "empty", artifactDigest: null },
          { step: 4, venue: "kraken", outcome: "trades", artifactDigest: artifact.ethCarried },
        ],
        price: { venue: "kraken", step: 4, candleStart: CUTOFF - 120, close: "200.00", usdtUsd: null, usdtArtifactDigest: null, priceE8: "20000000000", tradeAgeMinutes: 1, artifactDigest: artifact.ethCarried, admissible: true, rejection: null },
      },
    ],
    usdtUsd: { attempts: [] },
  };
}

function change(edit: (assets: ArchivedAsset[], view: ArchivedCutoff) => void): ArchivedCutoff {
  const view = archived();
  edit(view.assets, view);
  return view;
}

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MonitorMathError) return error.code;
    throw error;
  }
  return "no error";
}

describe("archived snapshot check", () => {
  it("matches the published snapshot digest when rebuilt from an archived cutoff", () => {
    expect(checkArchivedCutoff(archived())).toEqual({ cutoff: CUTOFF, verdict: "match", findings: [], snapshotDigest: wire.snapshot.digest });
  });

  it("reports a price that is not the archived close", () => {
    const result = checkArchivedCutoff(change((assets) => (assets[0]!.price!.priceE8 = "10000000001")));
    expect(result.verdict).toBe("mismatch");
    expect(result.findings.some((finding) => finding.startsWith("BTC: priceE8 10000000001 is not the close 100"))).toBe(true);
    expect(result.findings.some((finding) => finding.startsWith("snapshot digest"))).toBe(true);
  });

  it("reports a fallback used although an earlier venue had trades", () => {
    const result = checkArchivedCutoff(change((assets) => (assets[1]!.attempts[1]!.outcome = "trades")));
    expect(result.verdict).toBe("mismatch");
    expect(result.findings).toContain("ETH: step 2 (coinbase) had trades but step 4 was used");
  });

  it("reports a chosen venue with no archived attempt showing trades", () => {
    const result = checkArchivedCutoff(change((assets) => (assets[0]!.attempts[0]!.outcome = "empty")));
    expect(result.findings).toContain("BTC: no archived attempt shows trades at step 1 on kraken");
  });

  it("reports a digest that does not match the archived prices", () => {
    const result = checkArchivedCutoff(change((_, view) => (view.snapshot.digest = "ab".repeat(32))));
    expect(result.verdict).toBe("mismatch");
    expect(result.snapshotDigest).toBe(wire.snapshot.digest);
  });

  it("reports a missing or inadmissible price inside an admissible snapshot", () => {
    expect(checkArchivedCutoff(change((assets) => (assets[1]!.price = null))).findings).toContain("ETH: no price in an admissible snapshot");
    const rejected = checkArchivedCutoff(change((assets) => Object.assign(assets[1]!.price!, { admissible: false, rejection: "trade_age_exceeded" })));
    expect(rejected.findings).toContain("ETH: inadmissible price (trade_age_exceeded) in an admissible snapshot");
  });

  it("reports a carried Kraken close with no archived attempt behind it", () => {
    const result = checkArchivedCutoff(change((assets) => assets[1]!.attempts.pop()));
    expect(result.findings).toContain("ETH: no archived attempt shows trades at step 4 on kraken");
  });

  it("reports a carried price whose candle does not match its trade age", () => {
    const result = checkArchivedCutoff(change((assets) => (assets[1]!.price!.tradeAgeMinutes = 2)));
    expect(result.findings).toContain("snapshot cannot be encoded (InvalidSnapshotOrderOrTime)");
  });

  it("skips a snapshot archived before the wire encoding instead of calling it a mismatch", () => {
    const result = checkArchivedCutoff(change((_, view) => (view.snapshot.digestEncoding = null)));
    expect(result.verdict).toBe("skipped");
  });

  it("accepts an inadmissible snapshot only when it has no digest", () => {
    expect(checkArchivedCutoff(change((_, view) => (view.snapshot = { digest: null, digestEncoding: null, admissible: false }))).verdict).toBe("inadmissible");
    expect(checkArchivedCutoff(change((_, view) => (view.snapshot.admissible = false))).verdict).toBe("mismatch");
  });

  it("skips an inadmissible snapshot whose digest predates the wire encoding", () => {
    const result = checkArchivedCutoff(change((_, view) => (view.snapshot = { ...view.snapshot, digestEncoding: null, admissible: false })));
    expect(result.verdict).toBe("skipped");
  });
});

describe("price conversion", () => {
  it("converts a USD close exactly and refuses a ninth decimal even when it is zero", () => {
    expect(usdToE8("118420.5")).toBe(11842050000000n);
    expect(usdToE8("0.00000001")).toBe(1n);
    expect(code(() => usdToE8("1.000000000"))).toBe("InvalidUsdPrecision");
    expect(code(() => usdToE8("0"))).toBe("InvalidPrice");
    expect(code(() => usdToE8("1e3"))).toBe("InvalidUsdPrecision");
  });

  it("converts a USDT close once, rounding half away from zero at the end", () => {
    expect(usdtToE8("2.5", "0.9998")).toBe(249950000n);
    expect(usdtToE8("0.000000015", "1")).toBe(2n);
    expect(usdtToE8("0.000000014", "1")).toBe(1n);
  });

  it("checks a Bybit price against its close and the same cutoff's USDT rate", () => {
    const bybit = change((assets) => {
      assets[0]!.attempts = [
        { step: 1, venue: "kraken", outcome: "empty", artifactDigest: null },
        { step: 3, venue: "bybit", outcome: "trades", artifactDigest: artifact.btc },
      ];
      Object.assign(assets[0]!.price!, { venue: "bybit", step: 3, close: "2.5", usdtUsd: "0.9998", priceE8: "249950001" });
    });
    expect(checkArchivedCutoff(bybit).findings).toContain("BTC: priceE8 249950001 is not 2.5 USDT at 0.9998, expected 249950000");
  });
});

describe("archive artifacts", () => {
  const bodies: Record<string, string> = { [artifact.btc]: "btc frames", [artifact.ethEmpty]: "tampered" };
  const fetcher = (async (input: string | URL | Request) => {
    const digest = String(input).split("/").pop()!;
    const body = bodies[digest];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body);
  }) as typeof fetch;

  it("lists every artifact once", () => {
    expect(artifactDigests(archived())).toEqual([artifact.btc, artifact.ethEmpty, artifact.ethCarried].sort());
  });

  it("reports missing artifacts and bytes that do not hash to their digest", async () => {
    const findings = await checkArtifacts(archived(), httpEvidenceSource("http://archive.test/", fetcher));
    expect(findings).toHaveLength(2);
    expect(findings).toContain(`artifact ${artifact.ethCarried} is not in the archive`);
    expect(findings.some((finding) => finding.startsWith(`artifact ${artifact.ethEmpty}: evidence API returned bytes that do not hash`))).toBe(true);
  });
});

describe("evidence API cutoff route", () => {
  const view = { schema: "cox.evidence/v1", ...archived() };
  const source = (status: number, body: unknown) => httpEvidenceSource("http://archive.test", (async () => new Response(JSON.stringify(body), { status })) as typeof fetch);

  it("returns the archived cutoff, and nothing for a cutoff not archived yet", async () => {
    expect(await source(200, view).cutoff(CUTOFF)).toEqual(archived());
    expect(await source(404, {}).cutoff(CUTOFF)).toBeNull();
  });

  it("refuses a response for another cutoff or schema and a cutoff off the minute", async () => {
    await expect(source(200, { ...view, cutoff: CUTOFF + 60 }).cutoff(CUTOFF)).rejects.toBeInstanceOf(EvidenceUnavailable);
    await expect(source(200, { ...view, schema: "other" }).cutoff(CUTOFF)).rejects.toBeInstanceOf(EvidenceUnavailable);
    await expect(source(200, view).cutoff(CUTOFF + 1)).rejects.toBeInstanceOf(EvidenceUnavailable);
  });
});
