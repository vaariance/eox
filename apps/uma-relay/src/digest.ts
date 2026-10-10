import { createHash } from "node:crypto";

import { type Hex, bytesToHex, hexToBytes } from "viem";

export type ClaimKind = "evidence" | "snapshot";

const PREFIX = Buffer.from("EOX/ORACLE/V1\0");
const DOMAINS: Record<ClaimKind, string> = {
  evidence: "continuous-evidence-claim-v1",
  snapshot: "continuous-snapshot-claim-v1",
};

export function claimDigest(kind: ClaimKind, claim: Hex): Hex {
  const domain = Buffer.from(DOMAINS[kind]);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(domain.length);
  return bytesToHex(createHash("sha256").update(PREFIX).update(length).update(domain).update(hexToBytes(claim)).digest());
}
