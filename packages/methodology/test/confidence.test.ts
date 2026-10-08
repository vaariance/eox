import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CONFIDENCE_FACTORS, compileConfidence, type ConfidenceAssessment, type SourceAuthorityPolicy, PILOT_AUDIT_BINDINGS, INDICATORS } from "../src/index.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const policy: SourceAuthorityPolicy = { sourceId: "oecd", authorityBasisPoints: 9500, policyDigest: hash("synthetic-source-policy") };
function fixture(): ConfidenceAssessment {
  return {
    recordId: "synthetic-record", artifactDigest: hash("synthetic-payload"), sourceId: "oecd", assessorId: "synthetic-assessor", rubricDigest: hash("synthetic-rubric"),
    factors: Object.fromEntries(CONFIDENCE_FACTORS.map((factor, index) => [factor, {
      basisPoints: 9500 - index * 100, rationale: `Synthetic assessment for ${factor}`, supportingDigests: [hash(factor)],
    }])) as ConfidenceAssessment["factors"],
  };
}

test("confidence assertions emit all eight factors in the oracle's fixed order", () => {
  const result = compileConfidence(fixture(), policy);
  assert.deepEqual(result.confidenceBps, [9500, 9400, 9300, 9200, 9100, 9000, 8900, 8800]);
  assert.equal(result.manifestDigest, hash(result.canonicalManifest));
});

test("assertion order and duplicate provenance do not change commitment", () => {
  const input = fixture();
  const original = compileConfidence(input, policy);
  input.factors = Object.fromEntries(Object.entries(input.factors).reverse()) as ConfidenceAssessment["factors"];
  input.factors.releaseStatus.supportingDigests.push(...input.factors.releaseStatus.supportingDigests);
  assert.deepEqual(compileConfidence(input, policy), original);
});

test("missing factors, provenance, and invalid numeric ratings fail closed", () => {
  const missing = fixture();
  delete (missing.factors as Partial<ConfidenceAssessment["factors"]>).sourceAgreement;
  assert.throws(() => compileConfidence(missing, policy), /IncompleteConfidenceFactors/);
  for (const value of [-1, 10001, 0.5, NaN]) {
    const input = fixture();
    input.factors.completeness.basisPoints = value;
    assert.throws(() => compileConfidence(input, policy), /InvalidConfidenceBasisPoints/);
  }
  const input = fixture();
  input.factors.sourceAgreement.supportingDigests = [];
  assert.throws(() => compileConfidence(input, policy), /MissingFactorEvidence/);
  input.factors.sourceAgreement.supportingDigests = ["https://example.com/mutable-page"];
  assert.throws(() => compileConfidence(input, policy), /InvalidProvenanceDigest/);
  input.factors.sourceAgreement.supportingDigests = [hash("evidence")];
  input.factors.sourceAgreement.rationale = " ";
  assert.throws(() => compileConfidence(input, policy), /MissingConfidenceProvenance/);
});

test("source authority cannot silently differ from its immutable policy", () => {
  const input = fixture();
  input.factors.sourceAuthority.basisPoints = 10000;
  assert.throws(() => compileConfidence(input, policy), /SourceAuthorityMismatch/);
  assert.throws(() => compileConfidence(fixture(), { ...policy, sourceId: "bis" }), /ConfidenceSourceMismatch/);
});

test("all assessed facts and evidence bindings affect the commitment", () => {
  const original = compileConfidence(fixture(), policy);
  for (const mutate of [
    (input: ConfidenceAssessment) => { input.recordId = "new-record"; },
    (input: ConfidenceAssessment) => { input.artifactDigest = hash("new-payload"); },
    (input: ConfidenceAssessment) => { input.assessorId = "new-assessor"; },
    (input: ConfidenceAssessment) => { input.rubricDigest = hash("new-rubric"); },
    (input: ConfidenceAssessment) => { input.factors.completeness.basisPoints = 0; },
    (input: ConfidenceAssessment) => { input.factors.completeness.rationale = "new-reason"; },
    (input: ConfidenceAssessment) => { input.factors.completeness.supportingDigests = [hash("new-proof")]; },
  ]) {
    const input = fixture();
    mutate(input);
    assert.notEqual(compileConfidence(input, policy).manifestDigest, original.manifestDigest);
  }
  assert.notEqual(compileConfidence(fixture(), { ...policy, policyDigest: hash("new-policy") }).manifestDigest, original.manifestDigest);
});

test("pilot audit bindings preserve original item IDs and reported weighted scores", () => {
  assert.deepEqual(INDICATORS.map(indicator => PILOT_AUDIT_BINDINGS[indicator].item), [6, 17, 21, 22, 23, 24]);
  for (const binding of Object.values(PILOT_AUDIT_BINDINGS)) {
    const s = binding.scores;
    const hundredths = s.coverage * 25 + s.comparability * 20 + s.reliability * 20 + s.frequency * 15 + s.history * 10 + s.accessibility * 10;
    assert.equal((hundredths / 100).toFixed(2), binding.reportedOverall);
    assert.ok(binding.qualification.length > 0);
  }
});
