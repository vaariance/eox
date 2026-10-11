import type { Program } from "@coral-xyz/anchor";
import { CoxInstructions, decodeAccount, type OwnerKeys, type Pool } from "@cox/client";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import {
  batchFor,
  type DepositInput,
  type RedeemInput,
  type RequestActionInput,
  type SwitchInput,
  type TransactionOperation,
  type UnsignedTransaction,
  type WithdrawInput,
} from "@eox/app-api";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const INTEGER = /^(0|[1-9][0-9]{0,38})$/;
const OWNER = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_EXPIRY_BATCHES = 10_080;

export class TransactionInputError extends Error {}

export class TransactionRejectedError extends Error {
  constructor(
    message: string,
    readonly logs: string[],
  ) {
    super(message);
  }
}

export interface CoxTransactionContext {
  connection: Connection;
  program: Program;
  poolId: bigint;
  pool: PublicKey;
  vault: PublicKey;
  mint: PublicKey;
  origin: number;
  classes: readonly string[];
}

interface Built {
  operation: TransactionOperation;
  owner: PublicKey;
  instructions: TransactionInstruction[];
  details: Partial<Omit<UnsignedTransaction, "operation" | "owner" | "transaction" | "recentBlockhash" | "lastValidBlockHeight">>;
}

function owner(value: unknown): PublicKey {
  if (typeof value !== "string" || !OWNER.test(value)) throw new TransactionInputError("owner must be a base58 wallet address");
  const key = new PublicKey(value);
  if (!PublicKey.isOnCurve(key.toBytes())) throw new TransactionInputError("owner must be a wallet that can sign");
  return key;
}

function integer(value: unknown, name: string, max: bigint, positive: boolean): bigint {
  if (typeof value !== "string" || !INTEGER.test(value)) throw new TransactionInputError(`${name} must be an integer string`);
  const parsed = BigInt(value);
  if (parsed > max || (positive && parsed === 0n)) throw new TransactionInputError(`${name} is out of range`);
  return parsed;
}

export function associatedTokenAddress(wallet: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([wallet.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0];
}

function createTokenAccountIdempotent(payer: PublicKey, wallet: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(wallet, mint), isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export class CoxTransactions {
  private readonly instructions: CoxInstructions;

  constructor(
    private readonly context: CoxTransactionContext,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.instructions = new CoxInstructions(context.program);
  }

  private classIndex(value: unknown, name: string): number {
    const index = typeof value === "string" ? this.context.classes.indexOf(value) : -1;
    if (index < 0) throw new TransactionInputError(`${name} is not a class of this pool`);
    return index;
  }

  private expiry(value: unknown): { target: ReturnType<typeof batchFor>; expiry: bigint } {
    const target = batchFor(this.now(), this.context.origin);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < target.batch || value > target.batch + MAX_EXPIRY_BATCHES) {
      throw new TransactionInputError(`expiryBatch must be a batch from ${target.batch} to ${target.batch + MAX_EXPIRY_BATCHES}`);
    }
    return { target, expiry: BigInt(value) };
  }

  private async pool(): Promise<Pool> {
    const info = await this.context.connection.getAccountInfo(this.context.pool, "confirmed");
    if (!info) throw new TransactionInputError("the pool does not exist");
    return decodeAccount(this.context.program, "pool", info);
  }

  private async submission(wallet: PublicKey): Promise<{ keys: OwnerKeys; nonce: bigint }> {
    const nonce = BigInt((await this.pool()).nextRequestNonce.toString());
    const pdas = this.instructions.pdas;
    return {
      nonce,
      keys: {
        owner: wallet,
        pool: this.context.pool,
        vault: this.context.vault,
        position: pdas.position(this.context.pool, wallet),
        request: pdas.request(this.context.pool, nonce),
        userToken: associatedTokenAddress(wallet, this.context.mint),
      },
    };
  }

  async deposit(input: DepositInput): Promise<UnsignedTransaction> {
    const wallet = owner(input.owner);
    const to = this.classIndex(input.toClass, "toClass");
    const amount = integer(input.amount, "amount", U64_MAX, true);
    const minimumUnits = integer(input.minimumUnits, "minimumUnits", U128_MAX, false);
    const { target, expiry } = this.expiry(input.expiryBatch);
    const { keys, nonce } = await this.submission(wallet);
    return this.finish({
      operation: "deposit",
      owner: wallet,
      instructions: [this.instructions.deposit(keys, to, amount, minimumUnits, expiry)],
      details: { requestId: keys.request.toBase58(), nonce: nonce.toString(), targetBatch: target, expiryBatch: Number(expiry), toClass: this.context.classes[to]!, amount: amount.toString(), minimumUnits: minimumUnits.toString() },
    });
  }

  async switch(input: SwitchInput): Promise<UnsignedTransaction> {
    const wallet = owner(input.owner);
    const from = this.classIndex(input.fromClass, "fromClass");
    const to = this.classIndex(input.toClass, "toClass");
    if (from === to) throw new TransactionInputError("fromClass and toClass must differ");
    const units = integer(input.units, "units", U128_MAX, true);
    const minimumUnits = integer(input.minimumUnits, "minimumUnits", U128_MAX, false);
    const { target, expiry } = this.expiry(input.expiryBatch);
    const { keys, nonce } = await this.submission(wallet);
    return this.finish({
      operation: "switch",
      owner: wallet,
      instructions: [createTokenAccountIdempotent(wallet, wallet, this.context.mint), this.instructions.switch(keys, from, to, units, minimumUnits, expiry)],
      details: { requestId: keys.request.toBase58(), nonce: nonce.toString(), targetBatch: target, expiryBatch: Number(expiry), fromClass: this.context.classes[from]!, toClass: this.context.classes[to]!, units: units.toString(), minimumUnits: minimumUnits.toString() },
    });
  }

  async redeem(input: RedeemInput): Promise<UnsignedTransaction> {
    const wallet = owner(input.owner);
    const from = this.classIndex(input.fromClass, "fromClass");
    const units = integer(input.units, "units", U128_MAX, true);
    const minimumProceeds = integer(input.minimumProceeds, "minimumProceeds", U64_MAX, false);
    const { target, expiry } = this.expiry(input.expiryBatch);
    const { keys, nonce } = await this.submission(wallet);
    return this.finish({
      operation: "redeem",
      owner: wallet,
      instructions: [createTokenAccountIdempotent(wallet, wallet, this.context.mint), this.instructions.redeem(keys, from, units, minimumProceeds, expiry)],
      details: { requestId: keys.request.toBase58(), nonce: nonce.toString(), targetBatch: target, expiryBatch: Number(expiry), fromClass: this.context.classes[from]!, units: units.toString(), minimumProceeds: minimumProceeds.toString() },
    });
  }

  private async existingRequest(input: RequestActionInput): Promise<{ wallet: PublicKey; request: PublicKey; nonce: string }> {
    const wallet = owner(input.owner);
    if (typeof input.requestId !== "string" || !OWNER.test(input.requestId)) throw new TransactionInputError("requestId must be a request account address");
    const request = new PublicKey(input.requestId);
    const info = await this.context.connection.getAccountInfo(request, "confirmed");
    if (!info) throw new TransactionInputError("the request does not exist");
    const value = decodeAccount(this.context.program, "request", info);
    if (!value.pool.equals(this.context.pool) || !value.owner.equals(wallet) || !this.instructions.pdas.request(this.context.pool, BigInt(value.nonce.toString())).equals(request)) {
      throw new TransactionInputError("the request does not belong to this owner and pool");
    }
    return { wallet, request, nonce: value.nonce.toString() };
  }

  async cancel(input: RequestActionInput): Promise<UnsignedTransaction> {
    const { wallet, request, nonce } = await this.existingRequest(input);
    const position = this.instructions.pdas.position(this.context.pool, wallet);
    return this.finish({
      operation: "cancel",
      owner: wallet,
      instructions: [this.instructions.cancel({ owner: wallet, pool: this.context.pool, vault: this.context.vault, position, request })],
      details: { requestId: request.toBase58(), nonce },
    });
  }

  async refund(input: RequestActionInput): Promise<UnsignedTransaction> {
    const { wallet, request, nonce } = await this.existingRequest(input);
    const keys: OwnerKeys = {
      owner: wallet,
      pool: this.context.pool,
      vault: this.context.vault,
      position: this.instructions.pdas.position(this.context.pool, wallet),
      request,
      userToken: associatedTokenAddress(wallet, this.context.mint),
    };
    return this.finish({
      operation: "refund",
      owner: wallet,
      instructions: [createTokenAccountIdempotent(wallet, wallet, this.context.mint), this.instructions.refund(keys)],
      details: { requestId: request.toBase58(), nonce },
    });
  }

  async withdraw(input: WithdrawInput): Promise<UnsignedTransaction> {
    const wallet = owner(input.owner);
    const amount = integer(input.amount, "amount", U64_MAX, true);
    const keys = {
      owner: wallet,
      pool: this.context.pool,
      vault: this.context.vault,
      position: this.instructions.pdas.position(this.context.pool, wallet),
      userToken: associatedTokenAddress(wallet, this.context.mint),
    };
    return this.finish({
      operation: "withdraw",
      owner: wallet,
      instructions: [createTokenAccountIdempotent(wallet, wallet, this.context.mint), this.instructions.withdraw(keys, amount)],
      details: { amount: amount.toString() },
    });
  }

  private async finish(built: Built): Promise<UnsignedTransaction> {
    const { blockhash, lastValidBlockHeight } = await this.context.connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({ payerKey: built.owner, recentBlockhash: blockhash, instructions: built.instructions }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    const simulation = await this.context.connection.simulateTransaction(transaction, { sigVerify: false, commitment: "confirmed" });
    if (simulation.value.err) {
      const logs = simulation.value.logs ?? [];
      const reason = logs.find((line) => line.includes("Error Message:")) ?? JSON.stringify(simulation.value.err);
      throw new TransactionRejectedError(reason, logs);
    }
    return {
      operation: built.operation,
      owner: built.owner.toBase58(),
      transaction: Buffer.from(transaction.serialize()).toString("base64"),
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      requestId: null,
      nonce: null,
      targetBatch: null,
      expiryBatch: null,
      fromClass: null,
      toClass: null,
      amount: null,
      units: null,
      minimumUnits: null,
      minimumProceeds: null,
      ...built.details,
    };
  }
}
