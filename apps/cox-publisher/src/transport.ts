import anchor, { type Program } from "@coral-xyz/anchor";
import { createHash, createPublicKey, verify } from "node:crypto";
import { ComputeBudgetProgram, Connection, PublicKey, TransactionMessage, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { addresses, checkedPublication, CoxInstructions, decodeAccount, type Accounts } from "@cox/client";
import { PILOT_ASSETS } from "@cox/methodology";
import { SIGNING_SCHEMA_VERSION, type RemoteSigner, type SignedResult } from "@eox/signing";
import type { Chain, ChainView, Clock, MethodologyPolicy, Operation, PendingTransaction, StateStore } from "./types.ts";

const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export interface TransportOptions {
  program: Program; connection: Connection; poolId: bigint; policy: MethodologyPolicy;
  runtime: PublicKey; genesisHash: string; network: string; keyVersion: string;
  programSha256: string; computeUnitLimit: number; computeUnitPriceMicroLamports: number;
  signer: RemoteSigner; store: StateStore; clock: Clock;
  preservePublication: (info: AccountInfo<Buffer>, slot: number) => Promise<void>;
}

export function verifySigned(pending: PendingTransaction, result: SignedResult, runtime: PublicKey): { bytes: Buffer; signature: string } {
  if (result.schemaVersion !== SIGNING_SCHEMA_VERSION || result.requestId !== pending.requestId
      || result.payloadSha256 !== hash(Buffer.from(pending.unsignedBase64, "base64"))
      || result.signer.role !== "oracle-operator" || result.signer.address !== runtime.toBase58()
      || result.signer.keyVersion !== pending.keyVersion) throw new Error("SignerResponseMismatch");
  const bytes = Buffer.from(result.signedTransaction, "base64");
  if (bytes.toString("base64") !== result.signedTransaction) throw new Error("SignerEncodingMismatch");
  const signed = VersionedTransaction.deserialize(bytes);
  const unsigned = VersionedTransaction.deserialize(Buffer.from(pending.unsignedBase64, "base64"));
  if (!Buffer.from(signed.serialize()).equals(bytes) || signed.signatures.length !== 1 || signed.message.header.numRequiredSignatures !== 1 || !signed.message.staticAccountKeys[0]?.equals(runtime)
      || !Buffer.from(signed.message.serialize()).equals(Buffer.from(unsigned.message.serialize()))) throw new Error("SignerMessageMismatch");
  const signature = Buffer.from(result.signature, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== result.signature
      || !signature.equals(Buffer.from(signed.signatures[0]!))) throw new Error("SignerSignatureMismatch");
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), runtime.toBuffer()]), format: "der", type: "spki" });
  if (!verify(null, signed.message.serialize(), key, signature)) throw new Error("SignerSignatureInvalid");
  return { bytes, signature: anchor.utils.bytes.bs58.encode(signature) };
}

export class SolanaChain implements Chain {
  readonly pdas;
  readonly poolKey: PublicKey;
  private readonly instructions: CoxInstructions;
  constructor(private readonly options: TransportOptions) {
    this.pdas = addresses(options.program.programId);
    this.poolKey = this.pdas.pool(options.poolId);
    this.instructions = new CoxInstructions(options.program);
  }
  async initialize(): Promise<void> {
    const o = this.options;
    if (await o.connection.getGenesisHash() !== o.genesisHash) throw new Error("NetworkMismatch");
    const programInfo = await o.connection.getAccountInfo(o.program.programId, "finalized");
    if (!programInfo?.executable || !programInfo.owner.equals(LOADER) || programInfo.data.length !== 36
        || programInfo.data.readUInt32LE(0) !== 2) throw new Error("ProgramIdentityMismatch");
    const programData = PublicKey.findProgramAddressSync([o.program.programId.toBytes()], LOADER)[0];
    if (!programInfo.data.subarray(4, 36).equals(programData.toBuffer())) throw new Error("ProgramIdentityMismatch");
    const deployed = await o.connection.getAccountInfo(programData, "finalized");
    if (!deployed?.owner.equals(LOADER) || deployed.data.length < 45 || deployed.data.readUInt32LE(0) !== 3
        || hash(deployed.data.subarray(45)) !== o.programSha256) throw new Error("DeployedBuildMismatch");
    const key = await o.signer.getPublicKey("oracle-operator");
    const now = Number(o.clock.nowSeconds());
    if (key.role !== "oracle-operator" || key.state !== "active" || !Number.isSafeInteger(key.validFrom)
        || (key.validUntil !== null && !Number.isSafeInteger(key.validUntil))
        || key.address !== o.runtime.toBase58() || key.publicKey !== key.address || key.keyVersion !== o.keyVersion
        || key.network !== o.network || key.chain !== "solana" || key.environment !== "dev" || key.algorithm !== "ed25519"
        || key.validFrom > now || (key.validUntil !== null && key.validUntil <= now)) throw new Error("RuntimeKeyMismatch");
    const setup = await this.read();
    const mint = await o.connection.getAccountInfo(setup.pool.collateralMint, { commitment: "finalized", minContextSlot: setup.slot });
    if (!mint || !mint.owner.equals(TOKEN) || mint.data.length !== 82 || mint.data[44] !== 6 || mint.data[45] !== 1) throw new Error("CollateralMintMismatch");
  }
  private async read() {
    const o = this.options;
    const methodologyKey = this.pdas.methodology(Buffer.from(o.policy.digest, "hex"));
    const base = [this.pdas.registry(), this.poolKey, methodologyKey, this.pdas.vault(this.poolKey)];
    let expectedStage: PublicKey | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const keys = expectedStage ? [...base, expectedStage] : base;
      const response = await o.connection.getMultipleAccountsInfoAndContext(keys, { commitment: "finalized" });
      const account = <K extends keyof Accounts>(name: K, index: number): Accounts[K] => {
        const info = response.value[index];
        if (!info) throw new Error("SetupNotReady:" + name);
        return decodeAccount(o.program, name, info);
      };
      const registry = account("registry", 0);
      const pool = account("pool", 1);
      const methodology = account("methodology", 2);
      const vault = response.value[3];
      if (pool.poolId.toString() !== o.poolId.toString() || !pool.registry.equals(base[0]!)
          || !pool.methodology.equals(methodologyKey) || !pool.vault.equals(base[3]!)) throw new Error("PoolIdentityMismatch");
      if (!methodology.sealed || Buffer.from(methodology.digest).toString("hex") !== o.policy.digest
          || methodology.canonical.length !== methodology.expectedLength || hash(Buffer.from(methodology.canonical)) !== o.policy.digest
          || methodology.origin.toString() !== o.policy.origin.toString() || pool.origin.toString() !== o.policy.origin.toString()
          || methodology.bybit !== o.policy.bybit || methodology.roster.length !== o.policy.assets.length
          || methodology.roster.some((index, i) => PILOT_ASSETS[index]?.id !== o.policy.assets[i])) throw new Error("MethodologyMismatch");
      const active = pool.classes.reduce((sum, c) => sum + BigInt(c.backing.toString()), 0n);
      const required = active + BigInt(pool.pending.toString()) + BigInt(pool.payable.toString()) + BigInt(pool.residual.toString()) + BigInt(pool.fees.toString());
      if (active !== BigInt(pool.active.toString()) || pool.classes.length !== o.policy.assets.length + 1
          || pool.references.length !== pool.classes.length) throw new Error("PoolLedgerMismatch");
      if (!vault || !vault.owner.equals(TOKEN) || vault.data.length !== 165 || vault.data[108] !== 1
          || !vault.data.subarray(0, 32).equals(pool.collateralMint.toBuffer())
          || !vault.data.subarray(32, 64).equals(this.poolKey.toBuffer())) throw new Error("VaultIdentityMismatch");
      if (vault.data.readBigUInt64LE(64) < required) throw new Error("VaultShortfall");
      if (pool.stage && !pool.stage.equals(expectedStage ?? PublicKey.default)) { expectedStage = pool.stage; continue; }
      if (!pool.stage && expectedStage) { expectedStage = null; continue; }
      let stage = null;
      if (expectedStage) {
        const b = account("batch", 4);
        if (!b.pool.equals(this.poolKey) || !this.pdas.batch(this.poolKey).equals(expectedStage)
            || b.sequence.toString() !== (pool.initialized ? BigInt(pool.sequence.toString()) + 1n : 0n).toString()
            || b.predecessorSequence.toString() !== pool.sequence.toString()
            || !Buffer.from(b.predecessorDigest).equals(Buffer.from(pool.stateDigest))
            || BigInt(b.cutoff.toString()) !== o.policy.origin + BigInt(b.batchId.toString()) * 60n
            || BigInt(b.cursor.toString()) > BigInt(b.closedQueueEnd.toString())
            || ![0, 1, 3].includes(b.phase)) throw new Error("BatchIdentityMismatch");
        stage = { batchId: BigInt(b.batchId.toString()), sequence: BigInt(b.sequence.toString()), cutoff: BigInt(b.cutoff.toString()),
          phase: b.phase as 0 | 1 | 3, cursor: BigInt(b.cursor.toString()), closedQueueEnd: BigInt(b.closedQueueEnd.toString()), revision: hash(response.value[4]!.data) };
      }
      const view: ChainView = { paused: registry.paused, initialized: pool.initialized, origin: BigInt(pool.origin.toString()),
        lastBatch: BigInt(pool.lastBatch.toString()), sequence: BigInt(pool.sequence.toString()), stateDigest: Buffer.from(pool.stateDigest).toString("hex"), stage };
      return { registry, pool, methodology, view, slot: response.context.slot };
    }
    throw new Error("InconsistentRead");
  }
  async view(): Promise<ChainView> { return (await this.read()).view; }
  private async preserve(): Promise<void> {
    const o = this.options;
    const keys = [this.poolKey, this.pdas.publication(this.poolKey)];
    const response = await o.connection.getMultipleAccountsInfoAndContext(keys, { commitment: "finalized" });
    if (!response.value[0]) throw new Error("SetupNotReady:pool");
    const pool = decodeAccount(o.program, "pool", response.value[0]);
    if (pool.poolId.toString() !== o.poolId.toString()) throw new Error("PoolIdentityMismatch");
    if (!pool.initialized) return;
    const info = response.value[1];
    if (!info) throw new Error("SetupNotReady:publication");
    const publication = checkedPublication(o.program.programId, this.poolKey, decodeAccount(o.program, "publication", info));
    if (publication.sequence.toString() !== pool.sequence.toString()
        || !Buffer.from(publication.stateDigest).equals(Buffer.from(pool.stateDigest))) throw new Error("PublicationPoolMismatch");
    await o.preservePublication(info, response.context.slot);
  }
  private async clear(reason: string): Promise<void> {
    const state = await this.options.store.load();
    await this.options.store.save({ ...state, pending: null, lastOutcome: reason });
  }
  async recover(): Promise<boolean> {
    const o = this.options;
    let pending = (await o.store.load()).pending;
    if (!pending) return false;
    if (pending.keyVersion !== o.keyVersion) throw new Error("PendingKeyVersionMismatch");
    if (pending.signedBase64) {
      const transaction = VersionedTransaction.deserialize(Buffer.from(pending.signedBase64, "base64"));
      const checked = verifySigned(pending, { schemaVersion: SIGNING_SCHEMA_VERSION, requestId: pending.requestId,
        decision: "signed", payloadSha256: hash(Buffer.from(pending.unsignedBase64, "base64")),
        signer: { role: "oracle-operator", address: o.runtime.toBase58(), keyVersion: pending.keyVersion },
        signature: Buffer.from(transaction.signatures[0]!).toString("base64"), signedTransaction: pending.signedBase64,
        decidedAt: 0 }, o.runtime);
      if (checked.signature !== pending.signature) throw new Error("PendingSignatureMismatch");
    }
    let hasStatus = false;
    if (pending.signature) {
      const status = (await o.connection.getSignatureStatuses([pending.signature], { searchTransactionHistory: true })).value[0];
      if (status?.confirmationStatus === "finalized") { await this.read(); await this.clear(status.err ? "transaction-failed" : "transaction-finalized"); return false; }
      hasStatus = !!status;
    }
    if (await o.connection.getBlockHeight("finalized") > pending.lastValidBlockHeight) {
      const status = pending.signature ? (await o.connection.getSignatureStatuses([pending.signature], { searchTransactionHistory: true })).value[0] : null;
      await this.read();
      await this.clear(status?.confirmationStatus === "finalized"
        ? status.err ? "transaction-failed" : "transaction-finalized" : "transaction-expired-reconciled");
      return false;
    }
    if (hasStatus) return true;
    if ((await this.read()).view.paused) return true;
    await this.preserve();
    if (!pending.signedBase64) {
      if (Number(o.clock.nowSeconds()) >= pending.expiresAt) return true;
      const result = await o.signer.signSolanaTransaction({
        requestId: pending.requestId, role: "oracle-operator", keyVersion: pending.keyVersion, network: o.network,
        operation: { operationId: pending.operationId, kind: pending.kind }, expiresAt: pending.expiresAt,
        transactionBase64: pending.unsignedBase64,
      });
      if (result.decision !== "signed") throw new Error("SignerRejected:" + result.code);
      const signed = verifySigned(pending, result, o.runtime);
      pending = { ...pending, signedBase64: signed.bytes.toString("base64"), signature: signed.signature };
      const state = await o.store.load();
      await o.store.save({ ...state, pending });
    }
    const signature = await o.connection.sendRawTransaction(Buffer.from(pending.signedBase64!, "base64"), {
      skipPreflight: false, preflightCommitment: "finalized", maxRetries: 0,
    });
    if (signature !== pending.signature) throw new Error("BroadcastSignatureMismatch");
    return true;
  }
  async submit(operation: Operation): Promise<void> {
    const o = this.options;
    if ((await o.store.load()).pending) throw new Error("PendingTransactionExists");
    const { registry, pool, view, slot } = await this.read();
    if (view.paused) return;
    const keys = { pool: this.poolKey, vault: pool.vault };
    let instruction;
    if (operation.kind === "publish") {
      if (view.stage || view.stateDigest !== operation.revision) return;
      if (!operation.snapshot) throw new Error("MissingSnapshot");
      const cutoff = view.origin + operation.batchId * 60n;
      if (operation.sequence !== (view.initialized ? view.sequence + 1n : 0n)
          || operation.predecessor !== view.stateDigest || operation.snapshot.cutoff !== cutoff
          || (view.initialized ? operation.batchId <= view.lastBatch : operation.batchId !== 0n)) return;
      const now = o.clock.nowSeconds();
      if (now < cutoff || now > cutoff + 55n) return;
      const runtime = registry.pendingRuntime && operation.batchId >= BigInt(registry.runtimeEffectiveBatch.toString()) ? registry.pendingRuntime : registry.runtime;
      if (!runtime.equals(o.runtime)) throw new Error("RuntimeAuthorityMismatch");
      instruction = this.instructions.publish({ ...keys, payer: o.runtime, runtime: o.runtime, methodology: pool.methodology },
        operation.batchId, operation.sequence, Buffer.from(operation.predecessor, "hex"), operation.snapshot.prices,
        Buffer.from(operation.snapshot.digest, "hex"), operation.snapshot.archiveTime);
    } else {
      if (!view.stage || view.stage.revision !== operation.revision || view.stage.batchId !== operation.batchId
          || view.stage.sequence !== operation.sequence || view.stage.cursor !== operation.cursor
          || operation.predecessor !== view.stateDigest) return;
      const expected = view.stage.cursor < view.stage.closedQueueEnd
        ? view.stage.phase === 0 ? "evaluate" : view.stage.phase === 3 ? "safety" : "execute"
        : view.stage.phase === 1 ? "finalize" : "sealEvaluation";
      if (operation.kind !== expected) return;
      const batch = this.pdas.batch(this.poolKey);
      if (operation.kind === "sealEvaluation") instruction = this.instructions.sealEvaluation({ ...keys, batch });
      else if (operation.kind === "finalize") instruction = this.instructions.finalize({ ...keys, batch, methodology: pool.methodology, payer: o.runtime });
      else {
        const requestKey = this.pdas.request(this.poolKey, view.stage.cursor);
        const info = await o.connection.getAccountInfo(requestKey, { commitment: "finalized", minContextSlot: slot });
        if (!info) throw new Error("RequestNotFound");
        const request = decodeAccount(o.program, "request", info);
        if (!request.pool.equals(this.poolKey) || request.nonce.toString() !== view.stage.cursor.toString()) throw new Error("RequestIdentityMismatch");
        const processKeys = { ...keys, batch, request: requestKey, position: this.pdas.position(this.poolKey, request.owner) };
        instruction = this.instructions[operation.kind](processKeys);
      }
    }
    const latest = await o.connection.getLatestBlockhash("finalized");
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: o.runtime, recentBlockhash: latest.blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: o.computeUnitLimit }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: o.computeUnitPriceMicroLamports }), instruction],
    }).compileToLegacyMessage());
    const bytes = tx.serialize();
    if (bytes.length > 1232) throw new Error("TransactionTooLarge");
    const expiresAt = Number(o.clock.nowSeconds()) + 120;
    const requestId = "cox:" + hash(Buffer.from(operation.id + ":" + Buffer.from(bytes).toString("base64") + ":" + expiresAt));
    const pending: PendingTransaction = { operationId: operation.id, kind: operation.kind, requestId,
      batchId: operation.batchId.toString(), sequence: operation.sequence.toString(), revision: operation.revision,
      unsignedBase64: Buffer.from(bytes).toString("base64"), signedBase64: null, signature: null,
      blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, expiresAt, keyVersion: o.keyVersion };
    const state = await o.store.load();
    await o.store.save({ ...state, pending });
    await this.recover();
  }
}
