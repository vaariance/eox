import type { SourceRelease } from "@eox/evidence-store";
import { describe, expect, it } from "vitest";
import { publicationFor } from "../src/indicators/port-publication.js";
import { parseLayerMetadata } from "../src/sources/portwatch.js";

const release = (id: string, releasedAt: string, latestPeriod: string): SourceRelease => ({
  id,
  sourceId: "imf-portwatch",
  dataset: "Daily_Ports_Data",
  releasedAt: new Date(releasedAt),
  latestPeriod,
  metadataSha256: "a".repeat(64),
  periodsSha256: "b".repeat(64),
  recordedAt: new Date(releasedAt),
});

describe("publicationFor", () => {
  const previous = release("1", "2026-10-05T10:00:00.000Z", "2026-10-01");
  const current = release("2", "2026-10-06T18:41:27.589Z", "2026-10-02");

  it("dates a day first seen in a release after one that lacked it", () => {
    expect(publicationFor("2026-10-02", false, current, previous)).toEqual({ publishedAt: "2026-10-06T18:41:27.589Z", releaseId: "2" });
  });

  it("leaves the time unknown without proof that the day was absent before", () => {
    expect(publicationFor("2026-10-02", false, current, null)).toBeNull();
    expect(publicationFor("2026-10-02", false, null, previous)).toBeNull();
    expect(publicationFor("2026-10-01", false, current, previous)).toBeNull();
    expect(publicationFor("2026-10-02", false, current, release("1", "2026-10-05T10:00:00.000Z", "2026-10-02"))).toBeNull();
    expect(publicationFor("2026-10-03", false, current, previous)).toBeNull();
  });

  it("never dates a manually requested backfill day", () => {
    expect(publicationFor("2026-10-02", true, current, previous)).toBeNull();
  });
});

describe("parseLayerMetadata", () => {
  it("reads the source's data edit time", () => {
    expect(parseLayerMetadata('{"editingInfo":{"lastEditDate":1,"dataLastEditDate":1791312087589}}')).toBe("2026-10-06T18:41:27.589Z");
  });

  it("rejects metadata without a valid data edit time", () => {
    expect(() => parseLayerMetadata('{"editingInfo":{}}')).toThrow(/no data edit time/);
    expect(() => parseLayerMetadata('{"editingInfo":{"dataLastEditDate":"x"}}')).toThrow(/no data edit time/);
    expect(() => parseLayerMetadata('{"error":{"message":"down"}}')).toThrow(/PortWatch error: down/);
  });
});
