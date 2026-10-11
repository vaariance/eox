import { Buffer } from "buffer";
import type { Program } from "@coral-xyz/anchor";
import { PublicKey, SYSVAR_CLOCK_PUBKEY, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { CoxInstructions } from "./builders.ts";
import { PROGRAM_ID, addresses } from "./pdas.ts";
import { CoxReader, committedPosition, committedRequest, decodeAccount } from "./readers.ts";
import { CoxSimulations } from "./simulations.ts";
import { sha256 } from "./wire.ts";
import type { Pool, Position } from "./accounts.ts";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const U64_MAX = (1n << 64n) - 1n;
const UNIT_LIMIT = 10n ** 24n;
const COLLATERAL_LIMIT = 10n ** 11n;
export const COLLATERAL_DECIMALS = 6;
export const CRYPTO_UNIT_DECIMALS = 12;
export const DEVNET_TEST_COLLATERAL = new PublicKey("5rpGrekfBLHdF8PD8eKLzXQPPmhyF7FCKeE1VA5CwV3X");
const statuses = ["queued", "filled", "condition-failed", "expired", "zero-value-class", "cancelled", "refunded", "safety-rejected"] as const;
export type SwapRequestStatus = typeof statuses[number];
export interface SwapOptions { poolId: bigint; collateralMint: PublicKey }
export interface WalletAccounts { owner: PublicKey; tokenAccount: PublicKey }
export interface BuyCrypto extends WalletAccounts { amount: bigint; minimumUnits: bigint; expiryBatch: bigint }
export interface SellCrypto extends WalletAccounts { units: bigint; minimumProceeds: bigint; expiryBatch: bigint }
export interface SwapPlan {
  kind: "buy-crypto" | "sell-crypto" | "withdraw" | "cancel" | "expire" | "refund";
  owner: PublicKey;
  pool: PublicKey;
  collateralMint: PublicKey;
  testOnly: true;
  observedSequence: bigint;
  instructions: readonly TransactionInstruction[];
  request: { address: PublicKey; nonce: bigint; earliestBatchEstimate: bigint; expiryBatch: bigint } | null;
}
export interface SwapQuote {
  direction: "collateral-to-crypto" | "crypto-to-collateral";
  input: bigint;
  estimatedOutput: bigint;
  observedSequence: bigint;
  collateralMint: PublicKey;
  testOnly: true;
  execution: "future-publication";
  guaranteed: false;
}
export interface PreparedTransaction {
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}
export class SwapSdkError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "SwapSdkError"; }
}
function check(condition: boolean, code: string): asserts condition {
  if (!condition) throw new SwapSdkError(code);
}
function uint(value: bigint, maximum: bigint, positive = false): void {
  check(typeof value === "bigint" && value >= (positive ? 1n : 0n) && value <= maximum, "InvalidSwapAmount");
}
const number = (value: { toString(): string }) => BigInt(value.toString());

export class CoxSwapSdk {
  private readonly reader: CoxReader;
  private readonly builder: CoxInstructions;
  private readonly poolKey: PublicKey;
  private readonly pdas;
  private readonly program: Program;
  readonly options: SwapOptions;
  constructor(program: Program, options: SwapOptions) {
    this.program = program;
    this.options = options;
    check(program.programId.equals(PROGRAM_ID), "SwapProgramMismatch");
    uint(options.poolId, U64_MAX);
    this.reader = new CoxReader(program);
    this.builder = new CoxInstructions(program);
    this.pdas = addresses(program.programId);
    this.poolKey = this.pdas.pool(options.poolId);
  }
  private cryptoClass(pool: Pool): number { return pool.classes.length - 1; }
  private async context(owner?: PublicKey) {
    const connection = this.program.provider.connection;
    check(await connection.getGenesisHash() === DEVNET_GENESIS, "SwapNetworkMismatch");
    const initial = await this.reader.pool(this.options.poolId);
    const keys = [this.poolKey, this.pdas.registry(), initial.methodology, this.options.collateralMint,
      this.pdas.vault(this.poolKey), SYSVAR_CLOCK_PUBKEY];
    if (owner) keys.push(this.pdas.position(this.poolKey, owner));
    const response = await connection.getMultipleAccountsInfoAndContext(keys, { commitment: "finalized" });
    const [poolInfo, registryInfo, methodologyInfo, mint, vault, clock, positionInfo] = response.value;
    check(!!poolInfo && !!registryInfo && !!methodologyInfo && !!mint && !!vault && !!clock, "SwapSetupMissing");
    const pool = decodeAccount(this.program, "pool", poolInfo);
    const registry = decodeAccount(this.program, "registry", registryInfo);
    const methodology = decodeAccount(this.program, "methodology", methodologyInfo);
    check(pool.poolId.toString() === this.options.poolId.toString() && pool.registry.equals(keys[1]!)
      && pool.methodology.equals(keys[2]!) && pool.vault.equals(keys[4]!), "SwapPoolMismatch");
    check(pool.collateralMint.equals(this.options.collateralMint), "SwapCollateralMismatch");
    check(methodology.sealed && methodology.origin.eq(pool.origin)
      && this.pdas.methodology(Buffer.from(methodology.digest)).equals(pool.methodology)
      && methodology.canonical.length === methodology.expectedLength
      && sha256(Buffer.from(methodology.canonical)).equals(Buffer.from(methodology.digest)), "SwapMethodologyMismatch");
    check(pool.classes.length === methodology.roster.length + 1 && pool.classes.length >= 3 && pool.classes.length <= 31
      && pool.references.length === pool.classes.length
      && pool.classes.reduce((sum, value) => sum + number(value.backing), 0n) === number(pool.active), "SwapPoolLedgerMismatch");
    check(mint.owner.equals(TOKEN_PROGRAM) && mint.data.length === 82 && mint.data[44] === 6 && mint.data[45] === 1, "SwapCollateralMismatch");
    check(vault.owner.equals(TOKEN_PROGRAM) && vault.data.length === 165 && vault.data[108] === 1
      && vault.data.subarray(0, 32).equals(this.options.collateralMint.toBuffer())
      && vault.data.subarray(32, 64).equals(this.poolKey.toBuffer()), "SwapVaultMismatch");
    check(vault.data.readBigUInt64LE(64) >= number(pool.active) + number(pool.pending) + number(pool.payable) + number(pool.residual), "SwapCollateralShortfall");
    check(clock.data.length === 40, "SwapClockMismatch");
    const now = clock.data.readBigInt64LE(32);
    const origin = number(pool.origin);
    const halted = pool.initialized && now - (origin + number(pool.lastBatch) * 60n) >= 3600n;
    let position: Position | null = null;
    if (positionInfo && owner) {
      position = decodeAccount(this.program, "position", positionInfo);
      check(position.pool.equals(this.poolKey) && position.owner.equals(owner) && position.classes.length === pool.classes.length, "SwapPositionMismatch");
      position = committedPosition(position, pool);
    }
    return { pool, registry, methodology, now, halted, position };
  }
  private trading(context: Awaited<ReturnType<CoxSwapSdk["context"]>>) {
    check(context.pool.initialized, "SwapPoolNotInitialized");
    check(!context.registry.paused, "SwapPaused");
    check(!context.halted, "SwapHalted");
  }
  private async token(account: PublicKey, owner: PublicKey) {
    const info = await this.program.provider.connection.getAccountInfo(account, "finalized");
    check(!!info && info.owner.equals(TOKEN_PROGRAM) && info.data.length === 165 && info.data[108] === 1
      && info.data.subarray(0, 32).equals(this.options.collateralMint.toBuffer())
      && info.data.subarray(32, 64).equals(owner.toBuffer()), "SwapWalletTokenMismatch");
    return info.data.readBigUInt64LE(64);
  }
  private keys(wallet: WalletAccounts, nonce: bigint) {
    return { owner: wallet.owner, pool: this.poolKey, vault: this.pdas.vault(this.poolKey),
      position: this.pdas.position(this.poolKey, wallet.owner), request: this.pdas.request(this.poolKey, nonce), userToken: wallet.tokenAccount };
  }
  private plan(kind: SwapPlan["kind"], owner: PublicKey, pool: Pool, instruction: TransactionInstruction, request: SwapPlan["request"] = null): SwapPlan {
    return { kind, owner, pool: this.poolKey, collateralMint: this.options.collateralMint, testOnly: true,
      observedSequence: number(pool.sequence), instructions: [instruction], request };
  }
  private earliestBatch(context: Awaited<ReturnType<CoxSwapSdk["context"]>>) {
    const { pool, now } = context;
    return [((now - number(pool.origin)) / 60n) + 1n, number(pool.lastBatch) + 1n,
      pool.stage ? number(pool.stageBatch) + 1n : 0n].reduce((a, b) => a > b ? a : b);
  }
  private reservation(context: Awaited<ReturnType<CoxSwapSdk["context"]>>, expiryBatch: bigint) {
    uint(expiryBatch, U64_MAX);
    const { pool } = context;
    const earliestBatchEstimate = this.earliestBatch(context);
    check(expiryBatch >= earliestBatchEstimate, "SwapExpiryTooEarly");
    const nonce = number(pool.nextRequestNonce);
    return { address: this.pdas.request(this.poolKey, nonce), nonce, earliestBatchEstimate, expiryBatch };
  }
  async market() {
    const context = await this.context();
    return { pool: this.poolKey, collateralMint: this.options.collateralMint, collateralDecimals: COLLATERAL_DECIMALS,
      cryptoUnitDecimals: CRYPTO_UNIT_DECIMALS, cryptoClass: this.cryptoClass(context.pool), testOnly: true as const,
      benchmarkLabel: `CRYPTO (pilot, ${context.methodology.roster.length} assets)`, initialized: context.pool.initialized,
      paused: context.registry.paused, halted: context.halted, earliestBatchEstimate: this.earliestBatch(context), sequence: number(context.pool.sequence), batch: number(context.pool.lastBatch) };
  }
  async balances(owner: PublicKey) {
    const { position, pool } = await this.context(owner);
    const crypto = position?.classes[this.cryptoClass(pool)];
    const units = crypto ? number(crypto.units) : 0n;
    const locked = crypto ? number(crypto.locked) : 0n;
    check(locked <= units, "SwapPositionMismatch");
    return { owner, units, locked, availableUnits: units - locked, payable: position ? number(position.payable) : 0n,
      refundable: position ? number(position.refundable) : 0n, sequence: number(pool.sequence), collateralMint: this.options.collateralMint, testOnly: true as const };
  }
  async quoteBuy(owner: PublicKey, amount: bigint): Promise<SwapQuote> {
    uint(amount, COLLATERAL_LIMIT, true);
    return this.quote(owner, "collateral-to-crypto", amount);
  }
  async quoteSell(owner: PublicKey, units: bigint): Promise<SwapQuote> {
    uint(units, UNIT_LIMIT, true);
    return this.quote(owner, "crypto-to-collateral", units);
  }
  private async quote(owner: PublicKey, direction: SwapQuote["direction"], input: bigint): Promise<SwapQuote> {
    const context = await this.context();
    this.trading(context);
    const buying = direction === "collateral-to-crypto";
    const result = await new CoxSimulations(this.program, owner).quote(this.poolKey, buying ? 0 : 2,
      buying ? 255 : this.cryptoClass(context.pool), buying ? this.cryptoClass(context.pool) : 255, buying ? input : 0n, buying ? 0n : input);
    check(result.sequence.eq(context.pool.sequence), "SwapReadChangedRetry");
    return { direction, input, estimatedOutput: number(buying ? result.minted : result.proceeds),
      observedSequence: number(result.sequence), collateralMint: this.options.collateralMint, testOnly: true,
      execution: "future-publication", guaranteed: false };
  }
  async prepareBuy(input: BuyCrypto): Promise<SwapPlan> {
    uint(input.amount, COLLATERAL_LIMIT, true); uint(input.minimumUnits, UNIT_LIMIT);
    const context = await this.context(input.owner);
    this.trading(context);
    check(number(context.pool.active) + number(context.pool.pending) + input.amount <= COLLATERAL_LIMIT, "SwapCapacityExceeded");
    check(await this.token(input.tokenAccount, input.owner) >= input.amount, "SwapInsufficientCollateral");
    const request = this.reservation(context, input.expiryBatch);
    return this.plan("buy-crypto", input.owner, context.pool,
      this.builder.deposit(this.keys(input, request.nonce), this.cryptoClass(context.pool), input.amount, input.minimumUnits, input.expiryBatch), request);
  }
  async prepareSell(input: SellCrypto): Promise<SwapPlan> {
    uint(input.units, UNIT_LIMIT, true); uint(input.minimumProceeds, U64_MAX);
    const context = await this.context(input.owner);
    this.trading(context);
    const crypto = context.position?.classes[this.cryptoClass(context.pool)];
    check(!!crypto && number(crypto.units) - number(crypto.locked) >= input.units, "SwapInsufficientUnlockedUnits");
    await this.token(input.tokenAccount, input.owner);
    const request = this.reservation(context, input.expiryBatch);
    return this.plan("sell-crypto", input.owner, context.pool,
      this.builder.redeem(this.keys(input, request.nonce), this.cryptoClass(context.pool), input.units, input.minimumProceeds, input.expiryBatch), request);
  }
  private async ownedRequest(owner: PublicKey, nonce: bigint, pool: Pool) {
    uint(nonce, U64_MAX);
    const info = await this.program.provider.connection.getAccountInfo(this.pdas.request(this.poolKey, nonce), "finalized");
    check(!!info, "SwapRequestNotFound");
    const value = decodeAccount(this.program, "request", info);
    check(value.pool.equals(this.poolKey) && value.owner.equals(owner) && number(value.nonce) === nonce, "SwapRequestOwnerMismatch");
    check((value.operation === 0 && value.to === this.cryptoClass(pool)) || (value.operation === 2 && value.from === this.cryptoClass(pool)), "SwapRequestNotBenchmark");
    return committedRequest(value, pool);
  }
  async request(owner: PublicKey, nonce: bigint) {
    const { pool } = await this.context();
    const value = await this.ownedRequest(owner, nonce, pool);
    check(value.status >= 0 && value.status < statuses.length, "SwapRequestStatusUnknown");
    return { address: this.pdas.request(this.poolKey, nonce), owner, nonce, status: statuses[value.status]!,
      targetBatch: number(value.targetBatch), expiryBatch: number(value.expiryBatch),
      mintedUnits: value.status === 1 ? number(value.minted) : 0n,
      proceeds: value.status === 1 ? number(value.proceeds) : 0n,
      refundRequired: value.operation === 0 && [2, 3, 4, 5, 7].includes(value.status),
      createsPayable: value.operation === 2 && value.status === 1 && number(value.proceeds) > 0n };
  }
  async prepareWithdraw(input: WalletAccounts & { amount: bigint }): Promise<SwapPlan> {
    uint(input.amount, U64_MAX, true);
    const context = await this.context(input.owner);
    check(!context.halted, "SwapHalted");
    check(!!context.position && number(context.position.payable) >= input.amount, "SwapInsufficientPayable");
    await this.token(input.tokenAccount, input.owner);
    const { request: _, ...keys } = this.keys(input, 0n);
    return this.plan("withdraw", input.owner, context.pool, this.builder.withdraw(keys, input.amount));
  }
  async prepareRefund(input: WalletAccounts & { nonce: bigint }): Promise<SwapPlan> {
    const context = await this.context(input.owner);
    const request = await this.ownedRequest(input.owner, input.nonce, context.pool);
    check(request.operation === 0 && [2, 3, 4, 5, 7].includes(request.status)
      && !!context.position && number(context.position.refundable) >= number(request.amount), "SwapNotRefundable");
    await this.token(input.tokenAccount, input.owner);
    return this.plan("refund", input.owner, context.pool, this.builder.refund(this.keys(input, input.nonce)));
  }
  async prepareCancel(owner: PublicKey, nonce: bigint): Promise<SwapPlan> {
    return this.manage(owner, nonce, false);
  }
  async prepareExpire(owner: PublicKey, nonce: bigint): Promise<SwapPlan> {
    return this.manage(owner, nonce, true);
  }
  private async manage(owner: PublicKey, nonce: bigint, expire: boolean): Promise<SwapPlan> {
    const context = await this.context(owner);
    const { pool, now } = context;
    const request = await this.ownedRequest(owner, nonce, pool);
    check(request.status === 0, "SwapRequestAlreadyProcessed");
    check(!request.evaluated || request.boundSequence.lte(pool.sequence), "SwapCancellationClosed");
    check(!pool.stage || nonce >= number(pool.stageClosedEnd) || request.targetBatch.gt(pool.stageBatch), "SwapCancellationClosed");
    if (expire) check((now - number(pool.origin)) / 60n > number(request.expiryBatch), "SwapNotExpired");
    else {
      const rolled = pool.lastBatch.gte(request.targetBatch) ? number(pool.lastBatch) + 1n : number(request.targetBatch);
      check(now < number(pool.origin) + rolled * 60n || context.halted || context.registry.paused, "SwapCancellationClosed");
    }
    const keys = { owner, pool: this.poolKey, vault: this.pdas.vault(this.poolKey), position: this.pdas.position(this.poolKey, owner), request: this.pdas.request(this.poolKey, nonce) };
    const instruction = expire ? this.builder.expire({ authority: owner, pool: keys.pool, vault: keys.vault, position: keys.position, request: keys.request }) : this.builder.cancel(keys);
    return this.plan(expire ? "expire" : "cancel", owner, pool, instruction);
  }
  async transaction(plan: SwapPlan): Promise<PreparedTransaction> {
    check(plan.pool.equals(this.poolKey) && plan.collateralMint.equals(this.options.collateralMint) && plan.testOnly, "SwapPlanMismatch");
    if (plan.request) {
      const context = await this.context();
      this.trading(context);
      check(number(context.pool.nextRequestNonce) === plan.request.nonce, "SwapNonceChangedRebuild");
      this.reservation(context, plan.request.expiryBatch);
    }
    const { blockhash, lastValidBlockHeight } = await this.program.provider.connection.getLatestBlockhash("finalized");
    const message = new TransactionMessage({ payerKey: plan.owner, recentBlockhash: blockhash, instructions: [...plan.instructions] }).compileToV0Message();
    return { transaction: new VersionedTransaction(message), blockhash, lastValidBlockHeight };
  }
}
