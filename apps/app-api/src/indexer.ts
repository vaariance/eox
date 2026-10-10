import { readState, writeState } from "./state-file.js";

export interface PublicationEvent {
  snapshot: string;
  epoch: string;
  sequence: string;
  evidenceCutoff: string;
  evaluationTime: string;
  postcommitment: string;
}

export interface IndexedPublication extends PublicationEvent {
  signature: string;
  slot: number;
  blockTime: number | null;
}

export interface SignatureEntry {
  signature: string;
  slot: number;
  failed: boolean;
}

export interface FinalizedTransaction {
  slot: number;
  blockTime: number | null;
  failed: boolean;
  logs: string[];
}

export interface ChainClient {
  signaturesAfter(lastSignature: string | null): Promise<SignatureEntry[]>;
  transaction(signature: string): Promise<FinalizedTransaction | null>;
  publishedEvents(logs: string[]): PublicationEvent[];
  confirmPublished(event: PublicationEvent): Promise<boolean>;
}

interface IndexState {
  version: 1;
  lastSignature: string | null;
  publications: IndexedPublication[];
}

const INITIAL: IndexState = { version: 1, lastSignature: null, publications: [] };

export class PublicationIndexer {
  private state: IndexState = INITIAL;
  private readonly listeners = new Set<(publication: IndexedPublication) => void>();

  constructor(
    private readonly chain: ChainClient,
    private readonly statePath: string,
  ) {}

  async load(): Promise<void> {
    const state = await readState<IndexState>(this.statePath, INITIAL);
    if (state.version !== 1) throw new Error(`unsupported index state version ${String(state.version)}`);
    this.state = state;
  }

  publications(): readonly IndexedPublication[] {
    return this.state.publications;
  }

  onPublication(listener: (publication: IndexedPublication) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async tick(): Promise<number> {
    const entries = await this.chain.signaturesAfter(this.state.lastSignature);
    let added = 0;
    for (const entry of entries) {
      const found: IndexedPublication[] = [];
      if (!entry.failed) {
        const transaction = await this.chain.transaction(entry.signature);
        if (!transaction) throw new Error(`finalized transaction ${entry.signature} is not available yet`);
        if (!transaction.failed) {
          for (const event of this.chain.publishedEvents(transaction.logs)) {
            if (this.state.publications.some((p) => p.sequence === event.sequence)) continue;
            if (!(await this.chain.confirmPublished(event))) {
              throw new Error(`snapshot ${event.snapshot} does not match its publication event`);
            }
            found.push({ ...event, signature: entry.signature, slot: transaction.slot, blockTime: transaction.blockTime });
          }
        }
      }
      const publications = [...this.state.publications, ...found].sort((a, b) => Number(BigInt(a.sequence) - BigInt(b.sequence)));
      this.state = { version: 1, lastSignature: entry.signature, publications };
      await writeState(this.statePath, this.state);
      for (const publication of found) for (const listener of this.listeners) listener(publication);
      added += found.length;
    }
    return added;
  }
}
