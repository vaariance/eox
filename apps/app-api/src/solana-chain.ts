import anchor, { type Program } from "@coral-xyz/anchor";
import { setTimeout as sleep } from "node:timers/promises";
import type { Connection, PublicKey } from "@solana/web3.js";
import type { ReferenceReader } from "@eox/oracle-worker/references";
import type { ChainClient, FinalizedTransaction, PublicationEvent, SignatureEntry } from "./indexer.js";

const PAGE_LIMIT = 1000;
const EVENT_NAMES = new Set(["ReferencePublished", "referencePublished"]);

type EventValue = { toBase58?: () => string; toString: () => string };

function field(data: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) if (data[name] !== undefined) return data[name];
  throw new Error(`publication event is missing ${names[0]}`);
}

const hex = (value: unknown) => Buffer.from(value as number[]).toString("hex");
const key = (value: unknown) => (value as EventValue).toBase58!();
const integer = (value: unknown) => (value as EventValue).toString();

export class SolanaChainClient implements ChainClient {
  private readonly parser: anchor.EventParser;
  private nextCallAt = 0;

  constructor(
    private readonly connection: Connection,
    private readonly program: Program,
    private readonly reader: ReferenceReader,
    private readonly registry: PublicKey,
    private readonly minIntervalMs = 400,
  ) {
    this.parser = new anchor.EventParser(program.programId, program.coder);
  }

  private async pace(): Promise<void> {
    const wait = this.nextCallAt - Date.now();
    if (wait > 0) await sleep(wait);
    this.nextCallAt = Date.now() + this.minIntervalMs;
  }

  async signaturesAfter(lastSignature: string | null): Promise<SignatureEntry[]> {
    const newestFirst: SignatureEntry[] = [];
    let before: string | undefined;
    for (;;) {
      await this.pace();
      const page = await this.connection.getSignaturesForAddress(
        this.registry,
        { before, until: lastSignature ?? undefined, limit: PAGE_LIMIT },
        "finalized",
      );
      newestFirst.push(...page.map((entry) => ({ signature: entry.signature, slot: entry.slot, failed: entry.err !== null })));
      if (page.length < PAGE_LIMIT) break;
      before = page.at(-1)!.signature;
    }
    return newestFirst.reverse();
  }

  async transaction(signature: string): Promise<FinalizedTransaction | null> {
    await this.pace();
    const transaction = await this.connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
    if (!transaction?.meta) return null;
    return {
      slot: transaction.slot,
      blockTime: transaction.blockTime ?? null,
      failed: transaction.meta.err !== null,
      logs: transaction.meta.logMessages ?? [],
    };
  }

  publishedEvents(logs: string[]): PublicationEvent[] {
    const events: PublicationEvent[] = [];
    for (const event of this.parser.parseLogs(logs)) {
      if (!EVENT_NAMES.has(event.name)) continue;
      const data = event.data as Record<string, unknown>;
      events.push({
        snapshot: key(field(data, "snapshot")),
        epoch: key(field(data, "epoch")),
        sequence: integer(field(data, "sequence")),
        evidenceCutoff: integer(field(data, "evidenceCutoff", "evidence_cutoff")),
        evaluationTime: integer(field(data, "evaluationTime", "evaluation_time")),
        postcommitment: hex(field(data, "postcommitment")),
      });
    }
    return events;
  }

  async confirmPublished(event: PublicationEvent): Promise<boolean> {
    try {
      await this.pace();
      const snapshot = await this.reader.readSnapshot(event.snapshot);
      return snapshot.sequence === event.sequence && snapshot.epoch === event.epoch && snapshot.postcommitment === event.postcommitment;
    } catch {
      return false;
    }
  }
}
