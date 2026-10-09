import { createHash } from "node:crypto";

export type ProtocolHash = number[];
export interface ClaimContext {
  version: number;
  evm_chain_id: string;
  adapter: number[];
  solana_program: ProtocolHash;
  registry: ProtocolHash;
  epoch: string;
  methodology_manifest: ProtocolHash;
  configuration_digest: ProtocolHash;
  evidence_policy: ProtocolHash;
}
export interface EvidenceClaim {
  context: ClaimContext;
  evidence_digest: ProtocolHash;
  metadata_digest: ProtocolHash;
  record_id: string;
  artifact_digests: ProtocolHash[];
  assessment_digest: ProtocolHash;
  provenance_digests: ProtocolHash[];
}
export interface EvidenceBinding {
  record_id: string;
  evidence_digest: ProtocolHash;
  assessment_digest: ProtocolHash;
  assertion_id: ProtocolHash;
}
export interface ClaimSlot {
  country: number;
  indicator: number;
  current: EvidenceBinding;
  comparison: EvidenceBinding | null;
}
export interface SnapshotClaim {
  context: ClaimContext;
  proposal: ProtocolHash;
  precommitment: ProtocolHash;
  predecessor: ProtocolHash | null;
  cutoff: string;
  slots: ClaimSlot[];
  evidence_assertions: ProtocolHash[];
}
export interface RelayHeader {
  version: number;
  evm_chain_id: string;
  wormhole_chain: number;
  adapter: number[];
  solana_program: ProtocolHash;
  registry: ProtocolHash;
  epoch: string;
  proposal: ProtocolHash;
  precommitment: ProtocolHash;
  event_number: string;
}
export type RelayEvent =
  | { kind: "Registered"; uma: number[]; assertion_id: ProtocolHash; claim_kind: "Evidence" | "Snapshot"; claim_digest: ProtocolHash; subject: ProtocolHash; start: string; deadline: string }
  | { kind: "Disputed"; assertion_id: ProtocolHash; subject: ProtocolHash; dispute_id: ProtocolHash }
  | { kind: "Settled"; assertion_id: ProtocolHash; subject: ProtocolHash; accepted: boolean; disputed: boolean; settled_at: string }
  | { kind: "Closed"; assertion_set_digest: ProtocolHash; event_count: string; event_digest: ProtocolHash; accepted: boolean };
export interface RelayMessage { header: RelayHeader; event: RelayEvent }
export const PROTOCOL_DOMAINS = {
  evidence: "continuous-evidence-claim-v1",
  snapshot: "continuous-snapshot-claim-v1",
  relay: "continuous-relay-v1",
  assertions: "continuous-assertion-set-v1",
  events: "continuous-event-history-v1",
} as const;
const fail = (): never => { throw new Error("InvalidProtocolEncoding"); };
function uint(value: number, bytes: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value >= 2 ** (bytes * 8)) fail();
  const out = Buffer.alloc(bytes); out.writeUIntLE(value, 0, bytes); return out;
}
function u64(value: string): Buffer {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail();
  const n = BigInt(value); if (n > 0xffffffffffffffffn) fail();
  const out = Buffer.alloc(8); out.writeBigUInt64LE(n); return out;
}
function bytes(value: number[], size: number): Buffer {
  if (!Array.isArray(value) || value.length !== size || value.some(n => !Number.isInteger(n) || n < 0 || n > 255)) fail();
  return Buffer.from(value);
}
const hash = (v: ProtocolHash) => bytes(v, 32);
function flag(value: boolean): Buffer { if (typeof value !== "boolean") fail(); return uint(value ? 1 : 0, 1); }
function string(value: string): Buffer {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > 256 || value !== Buffer.from(value).toString("utf8")) fail();
  const b = Buffer.from(value); return Buffer.concat([uint(b.length, 4), b]);
}
function hashes(values: ProtocolHash[], max: number): Buffer {
  if (!Array.isArray(values) || !values.length || values.length > max) fail();
  const encoded = values.map(hash);
  for (let i = 1; i < encoded.length; i++) if (Buffer.compare(encoded[i - 1]!, encoded[i]!) >= 0) fail();
  return Buffer.concat([uint(values.length, 4), ...encoded]);
}
function context(c: ClaimContext): Buffer {
  if (c.version !== 1) fail();
  return Buffer.concat([uint(c.version, 2), u64(c.evm_chain_id), bytes(c.adapter, 20), hash(c.solana_program), hash(c.registry), u64(c.epoch), hash(c.methodology_manifest), hash(c.configuration_digest), hash(c.evidence_policy)]);
}
function binding(v: EvidenceBinding): Buffer { return Buffer.concat([string(v.record_id), hash(v.evidence_digest), hash(v.assessment_digest), hash(v.assertion_id)]); }
export function encodeEvidenceClaim(v: EvidenceClaim): Buffer {
  return Buffer.concat([context(v.context), hash(v.evidence_digest), hash(v.metadata_digest), string(v.record_id), hashes(v.artifact_digests, 64), hash(v.assessment_digest), hashes(v.provenance_digests, 64)]);
}
export function encodeSnapshotClaim(v: SnapshotClaim): Buffer {
  if (!Array.isArray(v.slots) || v.slots.length < 1 || v.slots.length > 960) fail();
  const expected = new Set<string>(); const bindings = new Map<string, string>(); let previous = -1;
  const remember = (b: EvidenceBinding) => {
    const id = hash(b.assertion_id).toString("hex"); const encoded = binding(b).toString("hex");
    if (bindings.has(id) && bindings.get(id) !== encoded) fail();
    bindings.set(id, encoded); expected.add(id);
  };
  const slots = v.slots.map(s => {
    if (!Number.isInteger(s.country) || s.country < 0 || s.country >= 30 || !Number.isInteger(s.indicator) || s.indicator < 0 || s.indicator >= 32) fail();
    const order = s.country * 32 + s.indicator; if (order <= previous) fail(); previous = order;
    remember(s.current);
    if (s.comparison !== null) remember(s.comparison);
    return Buffer.concat([uint(s.country, 1), uint(s.indicator, 1), binding(s.current), flag(s.comparison !== null), ...(s.comparison === null ? [] : [binding(s.comparison)])]);
  });
  const assertions = hashes(v.evidence_assertions, 1920);
  if (expected.size !== v.evidence_assertions.length || v.evidence_assertions.some(h => !expected.has(hash(h).toString("hex")))) fail();
  return Buffer.concat([context(v.context), hash(v.proposal), hash(v.precommitment), flag(v.predecessor !== null), ...(v.predecessor === null ? [] : [hash(v.predecessor)]), u64(v.cutoff), uint(slots.length, 4), ...slots, assertions]);
}
export function encodeRelayMessage(v: RelayMessage): Buffer {
  const h = v.header;
  if (h.version !== 1 || BigInt(h.event_number) === 0n) fail();
  const header = Buffer.concat([uint(h.version, 2), u64(h.evm_chain_id), uint(h.wormhole_chain, 2), bytes(h.adapter, 20), hash(h.solana_program), hash(h.registry), u64(h.epoch), hash(h.proposal), hash(h.precommitment), u64(h.event_number)]);
  const e = v.event; let body: Buffer;
  switch (e.kind) {
    case "Registered":
      if (!['Evidence', 'Snapshot'].includes(e.claim_kind)) fail();
      if (BigInt(e.deadline) - BigInt(e.start) !== 3600n) fail();
      body = Buffer.concat([uint(0, 1), bytes(e.uma, 20), hash(e.assertion_id), uint(e.claim_kind === "Evidence" ? 0 : 1, 1), hash(e.claim_digest), hash(e.subject), u64(e.start), u64(e.deadline)]); break;
    case "Disputed": body = Buffer.concat([uint(1, 1), hash(e.assertion_id), hash(e.subject), hash(e.dispute_id)]); break;
    case "Settled": body = Buffer.concat([uint(2, 1), hash(e.assertion_id), hash(e.subject), flag(e.accepted), flag(e.disputed), u64(e.settled_at)]); break;
    case "Closed":
      if (BigInt(e.event_count) + 1n !== BigInt(h.event_number)) fail();
      body = Buffer.concat([uint(3, 1), hash(e.assertion_set_digest), u64(e.event_count), hash(e.event_digest), flag(e.accepted)]); break;
    default: return fail();
  }
  return Buffer.concat([header, body]);
}
export function protocolDigest(domain: typeof PROTOCOL_DOMAINS[keyof typeof PROTOCOL_DOMAINS], encoded: Uint8Array): Buffer {
  const d = Buffer.from(domain);
  return createHash("sha256").update(Buffer.concat([Buffer.from("EOX/ORACLE/V1\0"), uint(d.length, 4), d, Buffer.from(encoded)])).digest();
}
export const evidenceClaimDigest = (v: EvidenceClaim) => protocolDigest(PROTOCOL_DOMAINS.evidence, encodeEvidenceClaim(v));
export const snapshotClaimDigest = (v: SnapshotClaim) => protocolDigest(PROTOCOL_DOMAINS.snapshot, encodeSnapshotClaim(v));
export const relayMessageDigest = (v: RelayMessage) => protocolDigest(PROTOCOL_DOMAINS.relay, encodeRelayMessage(v));
export function assertionSetDigest(evidence: ProtocolHash[], snapshot: ProtocolHash): Buffer {
  const list = hashes(evidence, 1920); const id = hash(snapshot);
  if (evidence.some(h => hash(h).equals(id))) fail();
  return protocolDigest(PROTOCOL_DOMAINS.assertions, Buffer.concat([list, id]));
}
export function eventHistoryDigest(previous: ProtocolHash, message: RelayMessage): Buffer {
  if (message.event.kind === "Closed") fail();
  return protocolDigest(PROTOCOL_DOMAINS.events, Buffer.concat([hash(previous), relayMessageDigest(message)]));
}
