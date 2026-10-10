import type { EvidenceClaim } from "./claims.js";
import { type EvidenceSource, EvidenceUnavailable } from "./evidence-source.js";

export type Verdict =
  | { outcome: "valid" }
  | { outcome: "invalid"; reason: string }
  | { outcome: "unverified"; reason: string };

export type EvidenceCheck = (claim: EvidenceClaim) => Promise<Verdict>;

export function sourceSupportCheck(source: EvidenceSource): EvidenceCheck {
  return async (claim) => {
    try {
      const fact = await source.record(claim.recordId);
      if (!fact) return { outcome: "invalid", reason: `record ${claim.recordId} is not oracle evidence in the evidence store` };
      const committed = claim.artifactDigests.map((digest) => digest.slice(2));
      if (!committed.includes(fact.artifactDigest)) {
        return { outcome: "invalid", reason: `the claim does not commit the record's source artifact ${fact.artifactDigest}` };
      }
      for (const digest of committed) {
        if (!(await source.hasArtifact(digest))) {
          return { outcome: "invalid", reason: `committed artifact ${digest} is not available from the evidence store` };
        }
      }
      return { outcome: "valid" };
    } catch (error) {
      if (error instanceof EvidenceUnavailable) return { outcome: "unverified", reason: error.message };
      throw error;
    }
  };
}

export async function runChecks(checks: readonly EvidenceCheck[], claim: EvidenceClaim): Promise<Verdict> {
  let unverified: Verdict | null = null;
  for (const check of checks) {
    const verdict = await check(claim);
    if (verdict.outcome === "invalid") return verdict;
    if (verdict.outcome === "unverified") unverified ??= verdict;
  }
  return unverified ?? { outcome: "valid" };
}
