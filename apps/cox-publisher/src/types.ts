import type { AssetId } from "@cox/methodology";
import type { PublishPrice } from "@cox/client";

export interface PublisherIdentity { program: string; pool: string; genesisHash: string }
export interface MethodologyPolicy { assets: readonly AssetId[]; origin: bigint; bybit: boolean; digest: string }
export interface Snapshot { cutoff: bigint; digest: string; archiveTime: bigint; prices: readonly PublishPrice[] }
export interface Stage { batchId: bigint; sequence: bigint; cutoff: bigint; phase: 0 | 1 | 2 | 3; cursor: bigint; closedQueueEnd: bigint; revision: string }
export interface ChainView {
  paused: boolean; initialized: boolean; origin: bigint; lastBatch: bigint;
  sequence: bigint; stateDigest: string; stage: Stage | null;
}
export type OperationKind = "publish" | "evaluate" | "safety" | "sealEvaluation" | "execute" | "finalize";
export interface Operation {
  id: string; kind: OperationKind; batchId: bigint; sequence: bigint;
  predecessor: string; revision: string; cursor?: bigint; snapshot?: Snapshot;
}
export interface PendingTransaction {
  operationId: string; kind: OperationKind; requestId: string; batchId: string; sequence: string;
  revision: string; unsignedBase64: string; signedBase64: string | null;
  signature: string | null; blockhash: string; lastValidBlockHeight: number; expiresAt: number; keyVersion: string;
}
export interface PublisherState {
  version: 1; identity: PublisherIdentity; pending: PendingTransaction | null;
  lastOutcome: string | null; lastCutoff: string | null;
}
export interface StateStore {
  load(): Promise<PublisherState>;
  save(state: PublisherState): Promise<void>;
}
export interface Archive { snapshot(cutoff: bigint, policy: MethodologyPolicy): Promise<Snapshot | null> }
export interface Chain {
  view(): Promise<ChainView>;
  recover(): Promise<boolean>;
  submit(operation: Operation): Promise<void>;
}
export interface Clock { nowSeconds(): bigint }
export type Outcome = "paused" | "pending" | "waiting" | "missed" | "inadmissible" | "submitted" | "origin-missed";
