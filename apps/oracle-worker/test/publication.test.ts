import assert from "node:assert/strict";
import test from "node:test";
import { admitPublicationTime } from "../src/publication.js";
import { adaptEvidence, metadataDigest } from "../src/codec.js";
import { assertReady } from "../src/provider.js";
import type { EvidenceRecord } from "../src/types.js";

function record(source: string): EvidenceRecord {
  return { recordId: "eox:observation:1", seriesId: "s", revisionId: "v1", country: "US",
    indicator: "gdp", source, unit: "index", period: "1", value: "100", publishedAt: null,
    knownAt: null, recordedAt: 1000, artifactDigest: "ab".repeat(32), manifest: "assessment",
    confidenceBps: [10000,10000,10000,10000,10000,10000,10000,10000] };
}

test("OECD and BIS without source time use immutable first observation for readiness and Rust input", () => {
  for (const source of ["oecd", "bis"]) {
    const r = record(source);
    assert.doesNotThrow(() => assertReady(r, 2000));
    assert.equal(admitPublicationTime(r, 2000).basis, "first-observed");
    assert.equal(adaptEvidence(r).published_at, 1000);
    assert.equal(adaptEvidence(r).published_at, admitPublicationTime(r, 5000).timestamp);
    assert.equal(r.publishedAt, null);
    const actual = { ...r, publishedAt: 1000 };
    assert.notDeepEqual(metadataDigest(r), metadataDigest(actual));
  }
});

test("source publication takes precedence and first observed cannot cross the cutoff", () => {
  const r = { ...record("oecd"), publishedAt: 900 };
  assert.deepEqual(admitPublicationTime(r, 1000), { policy: "EOX/PUBLICATION/V2", basis: "source", timestamp: 900 });
  assert.throws(() => admitPublicationTime(record("bis"), 999), /InvalidRecordedTime/);
  assert.throws(() => admitPublicationTime({ ...r, publishedAt: 1001 }, 1000), /InvalidPublicationTime/);
  assert.throws(() => admitPublicationTime(record("unknown")), /MissingPublicationTime/);
});

test("PortWatch drops milliseconds and emits exactly whole-second chain evidence", () => {
  const r = { ...record("imf-portwatch"), publication: { release: { releasedAtMs: 999999 } } };
  assert.doesNotThrow(() => assertReady(r, 1000));
  assert.equal(adaptEvidence(r).published_at, 999);
  assert.equal(admitPublicationTime({ ...record("imf-portwatch"), publishedAt: 999.999 }).timestamp, 999);
  assert.throws(() => admitPublicationTime(record("imf-portwatch")), /MissingPublicationTime/);
  assert.throws(() => admitPublicationTime({ ...r, publication: { release: { releasedAtMs: -1 } } }), /InvalidPublicationTime/);
});
