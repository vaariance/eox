import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as p from "../src/protocol.js";
const corpus = JSON.parse(readFileSync(new URL("../../../packages/oracle/fixtures/protocol-v1.json", import.meta.url), "utf8")) as {
  vectors: {name:string;kind:string;input:unknown;encodedHex:string;sha256:string}[];
  assertionSet:{evidence:number[][];snapshot:number[];sha256:string};
  eventHistory:{initial:number[];vectorNames:string[];sha256AfterEach:string[]};
};
for (const v of corpus.vectors) test(`protocol vector: ${v.name}`, () => {
  let encoded:Buffer, hash:Buffer;
  if(v.kind === "evidence") { encoded=p.encodeEvidenceClaim(v.input as p.EvidenceClaim); hash=p.evidenceClaimDigest(v.input as p.EvidenceClaim); }
  else if(v.kind === "snapshot") { encoded=p.encodeSnapshotClaim(v.input as p.SnapshotClaim); hash=p.snapshotClaimDigest(v.input as p.SnapshotClaim); }
  else { encoded=p.encodeRelayMessage(v.input as p.RelayMessage); hash=p.relayMessageDigest(v.input as p.RelayMessage); }
  assert.equal(encoded.toString("hex"), v.encodedHex); assert.equal(hash.toString("hex"), v.sha256);
});
test("closure binds reused evidence receipts plus one separately registered snapshot assertion", () => {
  const {evidence,snapshot,sha256}=corpus.assertionSet;
  assert.equal(p.assertionSetDigest(evidence,snapshot).toString("hex"),sha256);
  const initial=corpus.vectors[1]!.input as p.SnapshotClaim;
  const reused=corpus.vectors[2]!.input as p.SnapshotClaim;
  assert.deepEqual(initial.evidence_assertions,reused.evidence_assertions);
  assert.notEqual(corpus.vectors[1]!.sha256,corpus.vectors[2]!.sha256);
  assert.throws(()=>p.assertionSetDigest(evidence,evidence[0]!));
  let previous=corpus.eventHistory.initial;
  for(const [i,name] of corpus.eventHistory.vectorNames.entries()) {
    const message=corpus.vectors.find(v=>v.name===name)!.input as p.RelayMessage;
    const next=p.eventHistoryDigest(previous,message);
    assert.equal(next.toString("hex"),corpus.eventHistory.sha256AfterEach[i]);previous=[...next];
  }
});
test("claim validation rejects invalid identities, versions, precision and ambiguous ordering",()=>{
  const evidence=()=>structuredClone(corpus.vectors[0]!.input as p.EvidenceClaim);
  let e=evidence();e.context.version=2;assert.throws(()=>p.encodeEvidenceClaim(e));
  e=evidence();e.context.epoch="9007199254740993";assert.doesNotThrow(()=>p.encodeEvidenceClaim(e));
  e=evidence();e.context.epoch="01";assert.throws(()=>p.encodeEvidenceClaim(e));
  e=evidence();e.context.evm_chain_id="18446744073709551616";assert.throws(()=>p.encodeEvidenceClaim(e));
  e=evidence();e.context.adapter.pop();assert.throws(()=>p.encodeEvidenceClaim(e));
  e=evidence();e.artifact_digests.push(e.artifact_digests[0]!);assert.throws(()=>p.encodeEvidenceClaim(e));
  const s=structuredClone(corpus.vectors[1]!.input as p.SnapshotClaim);s.slots.push(s.slots[0]!);assert.throws(()=>p.encodeSnapshotClaim(s));
  const s2=structuredClone(corpus.vectors[1]!.input as p.SnapshotClaim);s2.evidence_assertions.pop();assert.throws(()=>p.encodeSnapshotClaim(s2));
  const s3=structuredClone(corpus.vectors[1]!.input as p.SnapshotClaim);
  s3.slots.push({...structuredClone(s3.slots[0]!),indicator:1});
  assert.doesNotThrow(()=>p.encodeSnapshotClaim(s3));
  s3.slots[1]!.current.record_id="conflicting-record";
  assert.throws(()=>p.encodeSnapshotClaim(s3));
});
test("relay validation binds full windows and closure history without claiming authentication",()=>{
  const r=structuredClone(corpus.vectors[3]!.input as p.RelayMessage);
  if(r.event.kind!=="Registered") throw new Error("fixture");
  r.event.deadline=String(BigInt(r.event.start)+3599n);assert.throws(()=>p.encodeRelayMessage(r));
  const closed=structuredClone(corpus.vectors[10]!.input as p.RelayMessage);
  assert.throws(()=>p.eventHistoryDigest(Array(32).fill(0),closed));
  closed.header.event_number="7";assert.throws(()=>p.encodeRelayMessage(closed));
  const body=p.encodeEvidenceClaim(corpus.vectors[0]!.input as p.EvidenceClaim);
  assert.notDeepEqual(p.protocolDigest(p.PROTOCOL_DOMAINS.evidence,body),p.protocolDigest(p.PROTOCOL_DOMAINS.snapshot,body));
});
