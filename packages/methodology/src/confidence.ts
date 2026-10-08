import { createHash } from "node:crypto";

export const CONFIDENCE_FACTORS = [
  "sourceAuthority", "releaseStatus", "completeness", "sourceIndependence",
  "sourceAgreement", "revisionHistory", "geographicSectorCoverage", "methodologicalContinuity",
] as const;
export type ConfidenceFactor = typeof CONFIDENCE_FACTORS[number];
export interface ConfidenceAssertion {
  basisPoints: number;
  rationale: string;
  supportingDigests: string[];
}
export interface ConfidenceAssessment {
  recordId: string;
  artifactDigest: string;
  sourceId: string;
  assessorId: string;
  rubricDigest: string;
  factors: Record<ConfidenceFactor, ConfidenceAssertion>;
}
export interface SourceAuthorityPolicy {
  sourceId: string;
  authorityBasisPoints: number;
  policyDigest: string;
}
export type ConfidenceBps = [number, number, number, number, number, number, number, number];

function basisPoints(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error("InvalidConfidenceBasisPoints");
}
function digest(value: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("InvalidProvenanceDigest");
}
function text(value: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error("MissingConfidenceProvenance");
}
export function compileConfidence(assessment: ConfidenceAssessment, policy: SourceAuthorityPolicy): {
  confidenceBps: ConfidenceBps; canonicalManifest: string; manifestDigest: string;
} {
  text(assessment.recordId);
  text(assessment.sourceId);
  text(assessment.assessorId);
  text(policy.sourceId);
  digest(assessment.artifactDigest);
  digest(assessment.rubricDigest);
  digest(policy.policyDigest);
  basisPoints(policy.authorityBasisPoints);
  if (assessment.sourceId !== policy.sourceId) throw new Error("ConfidenceSourceMismatch");
  if (!assessment.factors || Object.keys(assessment.factors).length !== CONFIDENCE_FACTORS.length) throw new Error("IncompleteConfidenceFactors");
  const ordered = CONFIDENCE_FACTORS.map(factor => {
    const assertion = assessment.factors[factor];
    if (!assertion) throw new Error(`MissingConfidenceFactor:${factor}`);
    basisPoints(assertion.basisPoints);
    text(assertion.rationale);
    if (!Array.isArray(assertion.supportingDigests) || assertion.supportingDigests.length === 0) throw new Error(`MissingFactorEvidence:${factor}`);
    assertion.supportingDigests.forEach(digest);
    if (factor === "sourceAuthority" && assertion.basisPoints !== policy.authorityBasisPoints) throw new Error("SourceAuthorityMismatch");
    return [factor, assertion.basisPoints, assertion.rationale, [...new Set(assertion.supportingDigests)].sort()] as const;
  });
  const confidenceBps = ordered.map(assertion => assertion[1]) as ConfidenceBps;
  const canonicalManifest = JSON.stringify([
    "EOX/CONFIDENCE-ASSERTIONS/V1", assessment.recordId, assessment.artifactDigest,
    assessment.sourceId, assessment.assessorId, assessment.rubricDigest, policy.policyDigest, ordered,
  ]);
  return { confidenceBps, canonicalManifest, manifestDigest: createHash("sha256").update(canonicalManifest).digest("hex") };
}
