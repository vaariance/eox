import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import anchor from "@coral-xyz/anchor";
import { discriminator } from "@cox/client";
import { ComputeBudgetProgram, PublicKey, SendTransactionError, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { Submission, TransactionOperation } from "@eox/app-api";
import { FeeChangedError, TransactionInputError, TransactionRejectedError } from "./transactions.js";

const SCHEMA = "cox.app-api.submissions/v1";
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MAX_TRANSACTION_BYTES = 1232;
const MAX_KEPT = 5000;
const OPERATIONS: readonly TransactionOperation[] = ["deposit", "switch", "redeem", "cancel", "refund", "withdraw"];
const TRADES = new Set<TransactionOperation>(["deposit", "switch", "redeem"]);
const FEE_INSTRUCTIONS: readonly { operation: TransactionOperation; name: string; length: number }[] = [
  { operation: "deposit", name: "deposit_with_fee", length: 49 },
  { operation: "switch", name: "switch_with_fee", length: 58 },
  { operation: "redeem", name: "redeem_with_fee", length: 49 },
];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

interface Stored extends Submission {
  recentBlockhash: string;
}

export interface CoxSubmissionsOptions {
  connection: Connection;
  programId: PublicKey;
  path: string;
  feeVersion: () => Promise<bigint>;
  now?: () => number;
}

interface Kind {
  operation: TransactionOperation;
  prefix: Buffer;
  feeLength: number | null;
}

function ed25519Key(bytes: Uint8Array) {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(bytes).toString("base64url") }, format: "jwk" });
}

export class CoxSubmissions {
  private readonly entries = new Map<string, Stored>();
  private readonly now: () => number;
  private readonly kinds: Kind[];

  constructor(private readonly options: CoxSubmissionsOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.kinds = [
      ...OPERATIONS.map((operation) => ({ operation, prefix: discriminator("global", operation), feeLength: null })),
      ...FEE_INSTRUCTIONS.map(({ operation, name, length }) => ({ operation, prefix: discriminator("global", name), feeLength: length })),
    ];
    mkdirSync(dirname(options.path), { recursive: true });
    if (existsSync(options.path)) {
      const stored = JSON.parse(readFileSync(options.path, "utf8")) as { schema: string; submissions: Stored[] };
      if (stored.schema !== SCHEMA) throw new Error(`unsupported submissions file ${options.path}`);
      for (const entry of stored.submissions) this.entries.set(entry.signature, entry);
    }
  }

  private inspect(bytes: Buffer): { signature: string; owner: PublicKey; operation: TransactionOperation; recentBlockhash: string; expectedFeeVersion: bigint | null } {
    if (bytes.length === 0 || bytes.length > MAX_TRANSACTION_BYTES) throw new TransactionInputError("transaction size is invalid");
    let transaction: VersionedTransaction;
    try {
      transaction = VersionedTransaction.deserialize(bytes);
    } catch {
      throw new TransactionInputError("transaction is not a serialized Solana transaction");
    }
    const { message } = transaction;
    if (message.addressTableLookups.length > 0) throw new TransactionInputError("address lookup tables are not accepted");
    const keys = message.staticAccountKeys;
    const signed = message.serialize();
    for (let i = 0; i < message.header.numRequiredSignatures; i += 1) {
      const signature = transaction.signatures[i];
      if (!signature || signature.every((b) => b === 0) || !verify(null, signed, ed25519Key(keys[i]!.toBytes()), signature)) {
        throw new TransactionInputError("transaction is not fully signed");
      }
    }
    const operations = new Set<TransactionOperation>();
    let expectedFeeVersion: bigint | null = null;
    for (const instruction of message.compiledInstructions) {
      const program = keys[instruction.programIdIndex]!;
      if (program.equals(this.options.programId)) {
        const data = Buffer.from(instruction.data);
        const kind = this.kinds.find((k) => data.subarray(0, 8).equals(k.prefix));
        if (!kind) throw new TransactionInputError("only wallet request instructions are accepted");
        if (kind.feeLength !== null) {
          if (data.length !== kind.feeLength) throw new TransactionInputError("fee-aware request instruction has an invalid length");
          expectedFeeVersion = data.readBigUInt64LE(data.length - 8);
        }
        operations.add(kind.operation);
      } else if (!program.equals(ASSOCIATED_TOKEN_PROGRAM) && !program.equals(ComputeBudgetProgram.programId)) {
        throw new TransactionInputError("transaction calls a program outside COX");
      }
    }
    if (operations.size !== 1) throw new TransactionInputError("transaction must carry exactly one COX request operation");
    return { signature: anchor.utils.bytes.bs58.encode(transaction.signatures[0]!), owner: keys[0]!, operation: [...operations][0]!, recentBlockhash: message.recentBlockhash, expectedFeeVersion };
  }

  async submit(encoded: unknown): Promise<Submission> {
    if (typeof encoded !== "string" || !BASE64.test(encoded)) throw new TransactionInputError("transaction must be base64");
    const bytes = Buffer.from(encoded, "base64");
    const inspected = this.inspect(bytes);
    const known = this.entries.get(inspected.signature);
    if (known) return (await this.get(known.signature))!;
    if (TRADES.has(inspected.operation) && (await this.options.feeVersion()) !== (inspected.expectedFeeVersion ?? 0n)) throw new FeeChangedError();
    let signature: string;
    try {
      signature = await this.options.connection.sendRawTransaction(bytes, { preflightCommitment: "confirmed", maxRetries: 5 });
    } catch (error) {
      if (error instanceof SendTransactionError) throw new TransactionRejectedError(error.message, error.logs ?? []);
      throw error;
    }
    if (signature !== inspected.signature) throw new Error("submitted signature differs from the transaction's first signature");
    const entry: Stored = {
      signature,
      owner: inspected.owner.toBase58(),
      operation: inspected.operation,
      transaction: encoded,
      submittedAt: this.now(),
      state: "submitted",
      slot: null,
      error: null,
      recentBlockhash: inspected.recentBlockhash,
    };
    this.entries.set(signature, entry);
    this.save();
    return this.view(entry);
  }

  async get(signature: string): Promise<Submission | null> {
    if (!SIGNATURE.test(signature)) throw new TransactionInputError("invalid signature");
    const entry = this.entries.get(signature);
    if (!entry) return null;
    if (entry.state === "submitted" || entry.state === "confirmed") await this.refresh(entry);
    return this.view(entry);
  }

  private async refresh(entry: Stored): Promise<void> {
    const connection = this.options.connection;
    const [status] = (await connection.getSignatureStatuses([entry.signature], { searchTransactionHistory: true })).value;
    if (status) {
      entry.slot = status.slot;
      if (status.err) {
        entry.state = "failed";
        entry.error = JSON.stringify(status.err);
      } else if (status.confirmationStatus === "finalized") {
        entry.state = "finalized";
      } else if (status.confirmationStatus === "confirmed") {
        entry.state = "confirmed";
      }
    } else if (!(await connection.isBlockhashValid(entry.recentBlockhash, { commitment: "confirmed" })).value) {
      entry.state = "expired";
    }
    this.save();
  }

  private view(entry: Stored): Submission {
    const { recentBlockhash: _, ...submission } = entry;
    return submission;
  }

  private save(): void {
    const all = [...this.entries.values()].sort((a, b) => a.submittedAt - b.submittedAt);
    for (const entry of all.slice(0, Math.max(0, all.length - MAX_KEPT))) this.entries.delete(entry.signature);
    const temporary = `${this.options.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schema: SCHEMA, submissions: [...this.entries.values()] }));
    renameSync(temporary, this.options.path);
  }
}
