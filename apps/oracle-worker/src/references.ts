import anchor, { type Program } from "@coral-xyz/anchor";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import type { IndexReference } from "./types.js";

type Integer = anchor.BN;
export interface RegistryAccount { authority: PublicKey; adapter: PublicKey; paused: boolean; active: PublicKey; latest: PublicKey; nextSequence: Integer; historyDigest: number[] }
export interface EpochAccount { registry: PublicKey; id: Integer; countries: number[][]; indicatorCounts: number[]; multiplier: number; configurationDigest: number[]; rulePages: number; sealed: boolean; baseline: Integer[]; baselineWorld: Integer; baselineSnapshot: PublicKey }
export interface CountryOutputAccount { normalizedSum: Integer; confidenceSum: Integer; weightSum: Integer; complete: boolean; state: Integer; confidence: Integer; saturated: boolean; stale: boolean; ratio: Integer; change: Integer; expressed: Integer; referenceConfidence: Integer }
export interface SnapshotAccount { registry: PublicKey; epoch: PublicKey; sequence: Integer; cutoff: Integer; predecessor: PublicKey; adapter: PublicKey; status: number; frozenPages: number; calculatedPages: number; evidenceDigest: number[]; precommitment: number[]; postcommitment: number[]; deadline: Integer; evaluationTime: Integer; publishedAt: Integer; eventDigest: number[]; eventCount: Integer; pending: number; closed: boolean; countries: CountryOutputAccount[]; world: Integer; worldConfidence: Integer }
export interface ReferenceAccountTypes { registry: RegistryAccount; epoch: EpochAccount; snapshot: SnapshotAccount }
export interface PublishedReference {
  scale: "1000000";
  snapshot: string;
  registry: string;
  epoch: string;
  epochId: string;
  sequence: string;
  configurationDigest: string;
  baselineSnapshot: string;
  predecessor: string | null;
  cutoff: string;
  postcommittedAt: string;
  publishedAt: string;
  evidenceDigest: string;
  precommitment: string;
  postcommitment: string;
  challengeEventDigest: string;
  challengeEventCount: string;
  multiplier: number;
  world: { state: string; confidence: string; baseline: string };
  countries: { country: string; state: string; confidence: string; baseline: string; saturated: boolean; stale: boolean; reference: IndexReference }[];
}
const hex = (bytes: number[]) => Buffer.from(bytes).toString("hex");
const u64 = (value: Integer) => value.toArrayLike(Buffer, "le", 8);
const pda = (program: Program, ...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];

export function decodeReferenceAccount<K extends keyof ReferenceAccountTypes>(program: Program, name: K, info: AccountInfo<Buffer>): ReferenceAccountTypes[K] {
  if (!info.owner.equals(program.programId)) throw new Error("AccountOwnerMismatch");
  return program.coder.accounts.decode(name, info.data) as ReferenceAccountTypes[K];
}

export class ReferenceReader {
  readonly registry: PublicKey;
  constructor(readonly program: Program) { this.registry = pda(program, Buffer.from("registry")); }
  private async account<K extends keyof ReferenceAccountTypes>(name: K, address: PublicKey): Promise<ReferenceAccountTypes[K]> {
    const info = await this.program.provider.connection.getAccountInfo(address, "finalized");
    if (!info) throw new Error(name === "snapshot" ? "SNAPSHOT_NOT_FOUND" : "ReferenceAccountMissing");
    return decodeReferenceAccount(this.program, name, info);
  }
  private async state(address?: string) {
    const registry = await this.account("registry", this.registry);
    const key = address ? new PublicKey(address) : registry.latest;
    if (key.equals(PublicKey.default)) throw new Error("NO_ACCEPTED_REFERENCE");
    const snapshot = await this.account("snapshot", key);
    if (snapshot.status !== 4) throw new Error("UnpublishedReference");
    const epoch = await this.account("epoch", snapshot.epoch);
    if (!snapshot.registry.equals(this.registry) || !epoch.registry.equals(this.registry)
      || !pda(this.program, Buffer.from("epoch"), u64(epoch.id)).equals(snapshot.epoch)
      || !pda(this.program, Buffer.from("snapshot"), snapshot.epoch.toBytes(), u64(snapshot.sequence)).equals(key)) throw new Error("ReferenceIdentityMismatch");
    if (!epoch.sealed || epoch.countries.length < 2 || epoch.countries.length > 30
      || epoch.countries.length !== snapshot.countries.length || epoch.baseline.length !== snapshot.countries.length
      || epoch.indicatorCounts.length !== snapshot.countries.length || snapshot.calculatedPages !== epoch.rulePages
      || snapshot.frozenPages !== epoch.rulePages || !snapshot.closed || snapshot.pending !== 0
      || snapshot.countries.some(c => !c.complete) || epoch.baselineSnapshot.equals(PublicKey.default)) throw new Error("IncompleteReference");
    const baseline = epoch.baselineSnapshot.equals(key) ? snapshot : await this.account("snapshot", epoch.baselineSnapshot);
    if (baseline.status !== 4 || !baseline.epoch.equals(snapshot.epoch) || !baseline.registry.equals(this.registry)
      || !pda(this.program, Buffer.from("snapshot"), snapshot.epoch.toBytes(), u64(baseline.sequence)).equals(epoch.baselineSnapshot)
      || baseline.sequence.gt(snapshot.sequence) || baseline.countries.length !== epoch.baseline.length
      || baseline.countries.some((c, i) => !c.complete || !c.state.eq(epoch.baseline[i]!))
      || !baseline.world.eq(epoch.baselineWorld)) throw new Error("BaselineMismatch");
    return { key, snapshot, epoch };
  }
  async readSnapshot(address?: string): Promise<PublishedReference> {
    const { key, snapshot: s, epoch: e } = await this.state(address);
    const identity = { snapshot: key.toBase58(), epoch: s.epoch.toBase58() };
    return {
      scale: "1000000", ...identity, registry: this.registry.toBase58(), epochId: e.id.toString(), sequence: s.sequence.toString(),
      configurationDigest: hex(e.configurationDigest), baselineSnapshot: e.baselineSnapshot.toBase58(),
      predecessor: s.predecessor.equals(PublicKey.default) ? null : s.predecessor.toBase58(), cutoff: s.cutoff.toString(),
      postcommittedAt: s.evaluationTime.toString(), publishedAt: s.publishedAt.toString(), evidenceDigest: hex(s.evidenceDigest),
      precommitment: hex(s.precommitment), postcommitment: hex(s.postcommitment), challengeEventDigest: hex(s.eventDigest), challengeEventCount: s.eventCount.toString(),
      multiplier: e.multiplier, world: { state: s.world.toString(), confidence: s.worldConfidence.toString(), baseline: e.baselineWorld.toString() },
      countries: s.countries.map((c, i) => ({ country: Buffer.from(e.countries[i]!).toString("ascii"), state: c.state.toString(), confidence: c.confidence.toString(),
        baseline: e.baseline[i]!.toString(), saturated: c.saturated, stale: c.stale,
        reference: { ...identity, base: Buffer.from(e.countries[i]!).toString("ascii"), quote: "WORLD", ratio: c.ratio.toString(), change: c.change.toString(), expressed: c.expressed.toString(), confidence: c.referenceConfidence.toString() } }))
    };
  }
  async readCountry(country: number, address?: string): Promise<IndexReference> {
    const snapshot = await this.readSnapshot(address);
    const value = snapshot.countries[country];
    if (!Number.isInteger(country) || !value) throw new Error("UNKNOWN_COUNTRY");
    return value.reference;
  }
  async readPair(address: string, base: number, quote: number): Promise<IndexReference> {
    const state = await this.readSnapshot(address);
    if (!Number.isInteger(base) || !Number.isInteger(quote) || !state.countries[base] || !state.countries[quote] || base === quote) throw new Error("INVALID_PAIR");
    const method = this.program.methods.readPair;
    if (!method) throw new Error("IDLMethodMissing:readPair");
    if (!this.program.provider.simulate) throw new Error("PairSimulationUnavailable");
    const tx = await method(base, quote).accountsPartial({ epoch: new PublicKey(state.epoch), snapshot: new PublicKey(address) }).transaction();
    const simulation = await this.program.provider.simulate(tx, [], "finalized");
    const returned = simulation.returnData;
    if (!returned || returned.programId !== this.program.programId.toBase58() || returned.data[1] !== "base64") throw new Error("MissingPairReturnData");
    const bytes = Buffer.from(returned.data[0], "base64");
    if (bytes.length !== 32) throw new Error("InvalidPairReturnData");
    return { snapshot: address, epoch: state.epoch, base: state.countries[base]!.country, quote: state.countries[quote]!.country,
      ratio: bytes.readBigInt64LE(0).toString(), change: bytes.readBigInt64LE(8).toString(), expressed: bytes.readBigInt64LE(16).toString(), confidence: bytes.readBigInt64LE(24).toString() };
  }
}
