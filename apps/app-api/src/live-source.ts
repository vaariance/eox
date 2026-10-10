import type { Program } from "@coral-xyz/anchor";
import { PublicKey, VersionedTransaction, type Commitment, type Connection, type Transaction } from "@solana/web3.js";
import type {
  CountryReference,
  Deployment,
  EvidenceReadiness,
  Proposal,
  ProposalState,
  Reference,
} from "@eox/app-api";
import { decodeReferenceAccount, type PublishedReference, type ReferenceReader } from "@eox/oracle-worker/references";
import type { IndexedPublication, PublicationIndexer } from "./indexer.js";
import type { PublishedSnapshot, ReferenceSource } from "./source.js";

const STATUS_NAMES: readonly ProposalState[] = [
  "draft",
  "precommitted",
  "postcommitted",
  "calculating",
  "published",
  "rejected",
  "cancelled",
  "expired",
];
const REGISTRY_CACHE_MS = 10_000;

function safeInteger(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${name} ${value} exceeds the safe integer range`);
  return number;
}

export interface LiveSourceOptions {
  network: string;
  connection: Connection;
  program: Program;
  reader: ReferenceReader;
  indexer: PublicationIndexer;
  readiness: () => Promise<EvidenceReadiness>;
  onError: (error: unknown) => void;
}

export function toPublishedSnapshot(reference: PublishedReference, publication: IndexedPublication): PublishedSnapshot {
  const countries: CountryReference[] = reference.countries.map((country) => ({
    country: country.country,
    state: country.state,
    confidence: country.confidence,
    saturated: country.saturated,
    stale: country.stale,
    baseline: country.baseline,
    reference: {
      ratio: country.reference.ratio,
      change: country.reference.change,
      expressed: country.reference.expressed,
      confidence: country.reference.confidence,
    },
  }));
  return {
    identity: {
      snapshotId: reference.snapshot,
      sequence: safeInteger(reference.sequence, "sequence"),
      epoch: reference.epochId,
      epochAddress: reference.epoch,
      configurationDigest: reference.configurationDigest,
      baselineId: reference.baselineSnapshot,
      predecessor: reference.predecessor,
      cutoff: safeInteger(reference.cutoff, "cutoff"),
      postcommittedAt: safeInteger(reference.postcommittedAt, "postcommittedAt"),
      publishedAt: safeInteger(reference.publishedAt, "publishedAt"),
      evidenceDigest: reference.evidenceDigest,
      precommitment: reference.precommitment,
      postcommitment: reference.postcommitment,
      challengeEventDigest: reference.challengeEventDigest,
      challengeEventCount: safeInteger(reference.challengeEventCount, "challengeEventCount"),
      finalization: { transaction: publication.signature, slot: publication.slot, finalized: true },
    },
    multiplier: reference.multiplier,
    world: { state: reference.world.state, confidence: reference.world.confidence, baseline: reference.world.baseline },
    countries,
  };
}

export class LiveReferenceSource implements ReferenceSource {
  private readonly snapshots = new Map<string, PublishedSnapshot>();
  private registryCache: { at: number; paused: boolean; active: PublicKey; authority: PublicKey } | null = null;

  constructor(private readonly options: LiveSourceOptions) {}

  private async registry() {
    if (this.registryCache && Date.now() - this.registryCache.at < REGISTRY_CACHE_MS) return this.registryCache;
    const info = await this.options.connection.getAccountInfo(this.options.reader.registry, "finalized");
    if (!info) throw new Error("oracle registry is not initialized");
    const registry = decodeReferenceAccount(this.options.program, "registry", info);
    this.registryCache = { at: Date.now(), paused: registry.paused, active: registry.active, authority: registry.authority };
    return this.registryCache;
  }

  async authority(): Promise<PublicKey> {
    return (await this.registry()).authority;
  }

  async deployment(): Promise<Deployment> {
    return {
      origin: "live",
      network: this.options.network,
      oracleProgram: this.options.program.programId.toBase58(),
      registry: this.options.reader.registry.toBase58(),
      fixtureSource: null,
    };
  }

  async publications(): Promise<readonly PublishedSnapshot[]> {
    const result: PublishedSnapshot[] = [];
    for (const publication of this.options.indexer.publications()) {
      let snapshot = this.snapshots.get(publication.snapshot);
      if (!snapshot) {
        snapshot = toPublishedSnapshot(await this.options.reader.readSnapshot(publication.snapshot), publication);
        this.snapshots.set(publication.snapshot, snapshot);
      }
      result.push(snapshot);
    }
    return result;
  }

  async pair(snapshot: PublishedSnapshot, base: string, quote: string): Promise<Reference | null> {
    const baseIndex = snapshot.countries.findIndex((c) => c.country === base);
    const quoteIndex = snapshot.countries.findIndex((c) => c.country === quote);
    if (baseIndex < 0 || quoteIndex < 0 || baseIndex === quoteIndex) return null;
    const pair = await this.options.reader.readPair(snapshot.identity.snapshotId, baseIndex, quoteIndex);
    return { ratio: pair.ratio, change: pair.change, expressed: pair.expressed, confidence: pair.confidence };
  }

  async paused(): Promise<boolean> {
    return (await this.registry()).paused;
  }

  async proposal(): Promise<Proposal | null> {
    const registry = await this.registry();
    if (registry.active.equals(PublicKey.default)) return null;
    const info = await this.options.connection.getAccountInfo(registry.active, "finalized");
    if (!info) return null;
    const snapshot = decodeReferenceAccount(this.options.program, "snapshot", info);
    const epochInfo = await this.options.connection.getAccountInfo(snapshot.epoch, "finalized");
    if (!epochInfo) throw new Error(`epoch ${snapshot.epoch.toBase58()} of the active proposal is missing`);
    const epoch = decodeReferenceAccount(this.options.program, "epoch", epochInfo);
    return {
      proposalId: registry.active.toBase58(),
      epoch: epoch.id.toString(),
      predecessor: snapshot.predecessor.equals(PublicKey.default) ? null : snapshot.predecessor.toBase58(),
      cutoff: safeInteger(snapshot.cutoff.toString(), "cutoff"),
      state: STATUS_NAMES[snapshot.status] ?? "draft",
      assertions: [],
    };
  }

  readiness(): Promise<EvidenceReadiness> {
    return this.options.readiness();
  }

  onPublication(listener: (snapshot: PublishedSnapshot) => void): () => void {
    return this.options.indexer.onPublication((publication) => {
      this.options.reader
        .readSnapshot(publication.snapshot)
        .then((reference) => {
          const snapshot = toPublishedSnapshot(reference, publication);
          this.snapshots.set(publication.snapshot, snapshot);
          listener(snapshot);
        })
        .catch(this.options.onError);
    });
  }
}

export function simulationProvider(connection: Connection, feePayer: () => Promise<PublicKey>) {
  return {
    connection,
    async simulate(transaction: Transaction, _signers?: unknown, commitment: Commitment = "finalized") {
      transaction.feePayer = await feePayer();
      transaction.recentBlockhash = PublicKey.default.toBase58();
      const result = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), {
        commitment,
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      if (result.value.err) throw new Error(`pair simulation failed: ${JSON.stringify(result.value.err)}`);
      return { logs: result.value.logs ?? [], returnData: result.value.returnData ?? undefined };
    },
  };
}
