import { getVersions, pool, recordSourcePayload, recordSourceRelease, type NewObservation } from "@eox/evidence-store";
import { afterAll, describe, expect, it } from "vitest";
import { recordRevisions } from "../src/record-revisions.js";

afterAll(async () => {
  await pool.end();
});

async function storePayload(label: string): Promise<string> {
  const payload = await recordSourcePayload({
    sourceId: "imf-portwatch",
    requestUrl: `https://example.test/${label}`,
    httpStatus: 200,
    contentType: "application/json",
    body: new TextEncoder().encode(label),
  });
  return payload.sha256;
}

describe("snapshot series", () => {
  const base: NewObservation = {
    countryIso3: "USA",
    indicatorId: "container_throughput",
    periodStart: "2026-09-25",
    periodEnd: "2026-09-25",
    value: "1000.000000",
    sourceId: "imf-portwatch",
    vintage: "daily_estimate",
    coverageReported: 10,
    coverageTotal: 10,
  };
  const q = { countryIso3: "USA", indicatorId: "container_throughput", sourceId: "imf-portwatch" };

  it("skips a rerun with identical value and coverage", async () => {
    expect(await recordRevisions([base])).toBe(1);
    expect(await recordRevisions([base])).toBe(0);
  });

  it("records a coverage change even when the value is unchanged", async () => {
    expect(await recordRevisions([{ ...base, coverageReported: 8 }])).toBe(1);
    const versions = await getVersions(q);
    expect(versions.map((row) => row.coverageReported)).toEqual([10, 8]);
  });

  it("re-records an unlinked snapshot value once a payload link is available", async () => {
    const payloadSha = await storePayload("snapshot-provenance");
    expect(await recordRevisions([{ ...base, coverageReported: 8, rawSha256: payloadSha }])).toBe(1);
    expect(await recordRevisions([{ ...base, coverageReported: 8, rawSha256: payloadSha }])).toBe(0);
  });

  it("records a value change linked to the latest version", async () => {
    expect(await recordRevisions([{ ...base, value: "1200.000000", coverageReported: 8 }])).toBe(1);
    const versions = await getVersions(q);
    expect(versions.at(-1)!.revisesId).toBe(versions.at(-2)!.id);
    expect(await recordRevisions([{ ...base, value: "1200.000000", coverageReported: 8 }])).toBe(0);
  });
});

describe("publication evidence", () => {
  it("re-records an unchanged value once verified release evidence arrives", async () => {
    const series: NewObservation = {
      countryIso3: "JPN",
      indicatorId: "container_throughput",
      periodStart: "2026-10-02",
      periodEnd: "2026-10-02",
      value: "500.000000",
      sourceId: "imf-portwatch",
      vintage: "daily_estimate",
      coverageReported: 3,
      coverageTotal: 3,
    };
    expect(await recordRevisions([series])).toBe(1);
    const release = await recordSourceRelease({
      sourceId: "imf-portwatch",
      dataset: "Daily_Ports_Data",
      releasedAt: "2026-10-06T18:41:27.589Z",
      latestPeriod: "2026-10-02",
      metadataSha256: await storePayload("release-layer"),
      periodsSha256: await storePayload("release-latest"),
    });
    const withRelease = { ...series, publishedAt: "2026-10-06T18:41:27.589Z", releaseId: release.id };
    expect(await recordRevisions([withRelease])).toBe(1);
    expect(await recordRevisions([withRelease])).toBe(0);
    expect(await recordRevisions([series])).toBe(0);
  });
});

describe("vintaged series", () => {
  const q = { countryIso3: "JPN", indicatorId: "gdp_real_volume", sourceId: "oecd" };
  const edition = (yyyymm: string, value: string): NewObservation => ({
    ...q,
    periodStart: "2025-01-01",
    periodEnd: "2025-03-31",
    value,
    vintage: `oecd-edition-${yyyymm}`,
    knownAt: `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}-01T00:00:00Z`,
  });

  it("backfills a missing historical edition that differs from its predecessor", async () => {
    expect(await recordRevisions([edition("202506", "100.000000"), edition("202609", "130.000000")])).toBe(2);
    expect(await recordRevisions([edition("202512", "120.000000")])).toBe(1);
    const versions = await getVersions(q);
    expect(versions.map((row) => row.vintage)).toEqual([
      "oecd-edition-202506",
      "oecd-edition-202512",
      "oecd-edition-202609",
    ]);
  });

  it("skips a historical edition that repeats its predecessor's value", async () => {
    expect(await recordRevisions([edition("202507", "100.000000")])).toBe(0);
  });

  it("skips an edition that is already stored", async () => {
    expect(await recordRevisions([edition("202512", "120.000000"), edition("202609", "130.000000")])).toBe(0);
  });

  it("does not re-record an edition only to add a payload link", async () => {
    const payloadSha = await storePayload("vintage-provenance");
    expect(await recordRevisions([{ ...edition("202610", "130.000000"), rawSha256: payloadSha }])).toBe(0);
  });

  it("links each recorded edition to the edition it revises", async () => {
    const versions = await getVersions(q);
    const byVintage = new Map(versions.map((row) => [row.vintage, row]));
    expect(byVintage.get("oecd-edition-202506")!.revisesId).toBeNull();
    expect(byVintage.get("oecd-edition-202512")!.revisesId).toBe(byVintage.get("oecd-edition-202506")!.id);
    expect(byVintage.get("oecd-edition-202609")!.revisesId).toBe(byVintage.get("oecd-edition-202506")!.id);
  });

  it("orders a mixed batch so each edition is compared with its true predecessor", async () => {
    const batch = [
      edition("202403", "95.000000"),
      edition("202401", "90.000000"),
      edition("202402", "90.000000"),
    ];
    expect(await recordRevisions(batch)).toBe(2);
    expect(await recordRevisions(batch)).toBe(0);
  });
});
