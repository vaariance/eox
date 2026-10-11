import type { Program } from "@coral-xyz/anchor";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import type { Accounts, Pool, Position, Request } from "./accounts.ts";
import { addresses } from "./pdas.ts";
import { decodeState, sha256 } from "./wire.ts";

export function decodeAccount<K extends keyof Accounts>(program: Program, name: K, info: AccountInfo<Buffer>): Accounts[K] {
  if (!info.owner.equals(program.programId)) throw new Error("AccountOwnerMismatch");
  const account = program.coder.accounts.decode(name, info.data) as Accounts[K];
  if (account.schemaVersion !== 1) throw new Error("AccountVersionMismatch");
  return account;
}
export function committedPosition(position: Position, pool: Pool): Position {
  if (position.appliedSequence.gt(pool.sequence)) throw new Error("InconsistentRead");
  if (!position.staged || !pool.initialized || position.stagedSequence.gt(pool.sequence)) return position;
  if ([position.stagedBurns, position.stagedMints, position.stagedUnlocks].some(values => values.length !== position.classes.length)) throw new Error("InvalidPositionStage");
  const classes = position.classes.map((value, index) => {
    const units = value.units.sub(position.stagedBurns[index]!).add(position.stagedMints[index]!);
    const locked = value.locked.sub(position.stagedUnlocks[index]!);
    if (units.isNeg() || locked.isNeg() || locked.gt(units)) throw new Error("InvalidPositionBalance");
    return { units, locked };
  });
  return { ...position, classes, appliedSequence: position.stagedSequence, payable: position.payable.add(position.stagedPayable), refundable: position.refundable.add(position.stagedRefundable), staged: false };
}
export function committedRequest(request: Request, pool: Pool): Request {
  if (request.status !== 0 && request.applied && request.boundSequence.gt(pool.sequence)) throw new Error("InconsistentRead");
  if (request.status !== 0 || !request.applied || !pool.initialized || request.boundSequence.gt(pool.sequence)) return request;
  if (request.receiptStatus < 0 || request.receiptStatus > 4) throw new Error("InvalidReceiptStatus");
  return { ...request, status: [1, 2, 3, 4, 7][request.receiptStatus]! };
}
export class CoxReader {
  readonly pdas;
  readonly program: Program;
  constructor(program: Program) { this.program = program; this.pdas = addresses(program.programId); }
  private async account<K extends keyof Accounts>(name: K, address: PublicKey): Promise<Accounts[K]> {
    const info = await this.program.provider.connection.getAccountInfo(address, "finalized");
    if (!info) throw new Error("CoxAccountNotFound");
    return decodeAccount(this.program, name, info);
  }
  async registry() { return this.account("registry", this.pdas.registry()); }
  async pool(poolId: bigint) {
    const key = this.pdas.pool(poolId);
    const pool = await this.account("pool", key);
    if (pool.poolId.toString() !== poolId.toString() || !pool.registry.equals(this.pdas.registry()) || !pool.vault.equals(this.pdas.vault(key))) throw new Error("PoolIdentityMismatch");
    if (pool.classes.length < 3 || pool.classes.length > 31 || pool.references.length !== pool.classes.length) throw new Error("PoolShapeMismatch");
    if (pool.classes.reduce((sum, value) => sum + BigInt(value.backing.toString()), 0n) !== BigInt(pool.active.toString())) throw new Error("PoolBackingMismatch");
    return pool;
  }
  async methodology(address: PublicKey) {
    const value = await this.account("methodology", address);
    if (!this.pdas.methodology(Buffer.from(value.digest)).equals(address)) throw new Error("MethodologyIdentityMismatch");
    if (value.sealed && (value.canonical.length !== value.expectedLength || !sha256(Buffer.from(value.canonical)).equals(Buffer.from(value.digest)))) throw new Error("MethodologyDigestMismatch");
    return value;
  }
  async position(poolId: bigint, owner: PublicKey) {
    const pool = await this.pool(poolId);
    const key = this.pdas.pool(poolId);
    const value = await this.account("position", this.pdas.position(key, owner));
    if (!value.pool.equals(key) || !value.owner.equals(owner) || value.classes.length !== pool.classes.length) throw new Error("PositionIdentityMismatch");
    return committedPosition(value, pool);
  }
  async request(poolId: bigint, nonce: bigint) {
    const pool = await this.pool(poolId);
    const key = this.pdas.pool(poolId);
    const value = await this.account("request", this.pdas.request(key, nonce));
    if (!value.pool.equals(key) || value.nonce.toString() !== nonce.toString()) throw new Error("RequestIdentityMismatch");
    return committedRequest(value, pool);
  }
  async batch(poolId: bigint, batchId: bigint) {
    const key = this.pdas.pool(poolId);
    const value = await this.account("batch", this.pdas.batch(key, batchId));
    if (!value.pool.equals(key) || value.batchId.toString() !== batchId.toString()) throw new Error("BatchIdentityMismatch");
    return value;
  }
  async publication(poolId: bigint, sequence: bigint) {
    const key = this.pdas.pool(poolId);
    const value = await this.account("publication", this.pdas.publication(key, sequence));
    if (!value.pool.equals(key) || value.sequence.toString() !== sequence.toString() || !sha256(Buffer.from(value.statePreimage)).equals(Buffer.from(value.stateDigest))) throw new Error("PublicationIdentityMismatch");
    const state = decodeState(Buffer.from(value.statePreimage));
    if (!Buffer.from(state.program).equals(this.program.programId.toBuffer()) || !Buffer.from(state.pool).equals(key.toBuffer()) || state.sequence !== sequence || state.batch.toString() !== value.batch.toString()
      || !Buffer.from(state.snapshot).equals(Buffer.from(value.snapshotDigest)) || !Buffer.from(state.manifest).equals(Buffer.from(value.manifestDigest))) throw new Error("PublicationStateMismatch");
    if (state.prices.length !== value.prices.length || state.prices.some((price, index) => price.toString() !== value.prices[index]!.priceE8.toString())) throw new Error("PublicationPriceMismatch");
    return { ...value, state };
  }
}
