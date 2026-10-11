import { createHash } from "node:crypto";
import type { Archive, Chain, Clock, MethodologyPolicy, Operation, Outcome, PublisherIdentity, StateStore } from "./types.js";

export interface PublisherOptions {
  identity: PublisherIdentity;
  policy: MethodologyPolicy;
  chain: Chain;
  archive: Archive;
  clock: Clock;
  store: StateStore;
}

export function operationId(identity: PublisherIdentity, operation: Omit<Operation, "id">): string {
  const material = JSON.stringify([
    "COX/PUBLISHER/OPERATION/V1", identity.genesisHash, identity.program, identity.pool,
    operation.kind, operation.batchId.toString(), operation.sequence.toString(),
    operation.predecessor, operation.revision, operation.cursor?.toString() ?? null,
    operation.snapshot?.cutoff.toString() ?? null, operation.snapshot?.digest ?? null,
    operation.snapshot?.archiveTime.toString() ?? null,
  ]);
  return createHash("sha256").update(material).digest("hex");
}

export class Publisher {
  private running = false;
  constructor(private readonly options: PublisherOptions) {}

  async tick(): Promise<Outcome> {
    if (this.running) throw new Error("ConcurrentPublisherTick");
    this.running = true;
    try { return await this.run(); } finally { this.running = false; }
  }

  private async outcome(outcome: Outcome, cutoff?: bigint): Promise<Outcome> {
    const state = await this.options.store.load();
    await this.options.store.save({ ...state, lastOutcome: outcome, lastCutoff: cutoff?.toString() ?? state.lastCutoff });
    return outcome;
  }

  private async submit(operation: Omit<Operation, "id">): Promise<Outcome> {
    await this.options.chain.submit({ ...operation, id: operationId(this.options.identity, operation) });
    return this.outcome("submitted", operation.snapshot?.cutoff);
  }

  private async run(): Promise<Outcome> {
    const { chain, archive, clock, policy } = this.options;
    if (await chain.recover()) return this.outcome("pending");
    const view = await chain.view();
    if (view.origin !== policy.origin || view.origin < 0n || view.origin % 60n !== 0n) throw new Error("MethodologyOriginMismatch");
    if (view.paused) return this.outcome("paused");
    if (view.stage) {
      const stage = view.stage;
      if (stage.phase === 2 || stage.cursor > stage.closedQueueEnd) throw new Error("InconsistentActiveBatch");
      const kind = stage.cursor < stage.closedQueueEnd
        ? stage.phase === 0 ? "evaluate" : stage.phase === 3 ? "safety" : "execute"
        : stage.phase === 1 ? "finalize" : "sealEvaluation";
      return this.submit({ kind, batchId: stage.batchId, sequence: stage.sequence,
        predecessor: view.stateDigest, revision: stage.revision, cursor: stage.cursor });
    }
    const now = clock.nowSeconds();
    if (now < view.origin) return this.outcome("waiting");
    if (!view.initialized && now > view.origin + 55n) return this.outcome("origin-missed", view.origin);
    const batchId = (now - view.origin) / 60n;
    const cutoff = view.origin + batchId * 60n;
    if (view.initialized && batchId <= view.lastBatch) return this.outcome("waiting", cutoff);
    if (now > cutoff + 55n) return this.outcome("missed", cutoff);
    const snapshot = await archive.snapshot(cutoff, policy);
    if (!snapshot) return this.outcome("inadmissible", cutoff);
    if (snapshot.cutoff !== cutoff || snapshot.archiveTime < cutoff || snapshot.archiveTime > cutoff + 30n
      || snapshot.archiveTime > clock.nowSeconds()) throw new Error("InvalidArchiveSnapshot");
    if (clock.nowSeconds() > cutoff + 55n) return this.outcome(view.initialized ? "missed" : "origin-missed", cutoff);
    return this.submit({ kind: "publish", batchId, sequence: view.initialized ? view.sequence + 1n : 0n,
      predecessor: view.stateDigest, revision: view.stateDigest, snapshot });
  }
}
