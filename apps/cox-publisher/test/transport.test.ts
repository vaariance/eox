import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import anchor, { type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { addresses, decodeAccount, type Accounts, type PublishPrice } from "@cox/client";
import { PILOT_ASSETS, type AssetId } from "@cox/methodology";
import { SIGNING_SCHEMA_VERSION, type RemoteSigner, type SignSolanaTransactionRequest, type SignedResult, type KeyDirectoryEntry } from "@eox/signing";
import { emptyState } from "../src/journal.ts";
import { SolanaChain, verifySigned, type TransportOptions } from "../src/transport.ts";
import type { Operation, PublisherState } from "../src/types.ts";

const idl = JSON.parse(readFileSync(new URL("../../../packages/cox/idl/cox.json", import.meta.url), "utf8")) as Idl;
interface Fixture { name: keyof Accounts; address: string; owner: string; dataHex: string }
const fixtures = JSON.parse(readFileSync(new URL("../../../packages/cox/fixtures/accounts.json", import.meta.url), "utf8")) as { accounts: Fixture[] };
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const info = (data: Buffer, owner: PublicKey): AccountInfo<Buffer> => ({ data, owner, executable: false, lamports: 100000000, rentEpoch: 0 });

async function setup() {
  const runtime = Keypair.generate();
  const events: string[] = [];
  const broadcasts: Buffer[] = [];
  const requests: Omit<SignSolanaTransactionRequest, "chain">[] = [];
  const map = new Map<string, AccountInfo<Buffer>>();
  let state: PublisherState;
  let height = 10;
  let status: { confirmationStatus: "processed" | "confirmed" | "finalized"; err: null | { InstructionError: [number, string] } } | null = null;
  let loseSignerResponse = false;
  let loseBroadcastResponse = false;
  let breakReads = false;
  let now = 1800000061n;
  const connection = {
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => {
      events.push("read");
      if (breakReads) throw new Error("ReadUnavailable");
      return { context: { slot: 7 }, value: keys.map(key => map.get(key.toBase58()) ?? null) };
    },
    getAccountInfo: async (key: PublicKey) => map.get(key.toBase58()) ?? null,
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    getBlockHeight: async () => height,
    getSignatureStatuses: async () => ({ value: [status] }),
    sendRawTransaction: async (bytes: Uint8Array) => {
      events.push("broadcast");
      assert.equal(state.pending?.signedBase64, Buffer.from(bytes).toString("base64"));
      assert.ok(state.pending?.signature);
      broadcasts.push(Buffer.from(bytes));
      if (loseBroadcastResponse) { loseBroadcastResponse = false; throw new Error("BroadcastTimeout"); }
      return anchor.utils.bytes.bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]!);
    },
  } as unknown as Connection;
  const program = new anchor.Program(idl, { connection });
  for (const f of fixtures.accounts) map.set(f.address, info(Buffer.from(f.dataHex, "hex"), new PublicKey(f.owner)));
  const fixture = <K extends keyof Accounts>(name: K): Accounts[K] => {
    const f = fixtures.accounts.find(f => f.name === name)!;
    return decodeAccount(program, name, map.get(f.address)!);
  };
  const pool = fixture("pool"), methodology = fixture("methodology"), registry = fixture("registry"), batch = fixture("batch");
  const pdas = addresses(program.programId);
  const poolId = BigInt(pool.poolId.toString());
  const poolKey = pdas.pool(poolId);
  registry.runtime = runtime.publicKey; registry.pendingRuntime = null; registry.paused = false;
  pool.stage = null;
  const policy = { assets: Array.from(methodology.roster, index => PILOT_ASSETS[index]!.id as AssetId), origin: BigInt(methodology.origin.toString()),
    bybit: methodology.bybit, digest: Buffer.from(methodology.digest).toString("hex") };
  now = policy.origin + BigInt(pool.lastBatch.toString()) * 60n + 61n;
  const identity = { program: program.programId.toBase58(), pool: poolKey.toBase58(), genesisHash: "genesis" };
  state = emptyState(identity);
  const saveAccount = async <K extends keyof Accounts>(name: K, value: Accounts[K], key?: PublicKey) => {
    const f = fixtures.accounts.find(f => f.name === name)!;
    const coder = program.coder.accounts as unknown as { accountLayouts: Map<string, { layout: { encode(value: unknown, bytes: Buffer): number }; discriminator: number[] }> };
    const entry = coder.accountLayouts.get(name)!;
    const bytes = Buffer.alloc(20000);
    const size = entry.layout.encode(value, bytes);
    const data = Buffer.concat([Buffer.from(entry.discriminator), bytes.subarray(0, size)]);
    map.set(key?.toBase58() ?? f.address, info(data, program.programId));
  };
  await saveAccount("pool", pool); await saveAccount("registry", registry);
  const vault = Buffer.alloc(165);
  pool.collateralMint.toBuffer().copy(vault, 0); poolKey.toBuffer().copy(vault, 32); vault[108] = 1;
  const required = BigInt(pool.active.toString()) + BigInt(pool.pending.toString()) + BigInt(pool.payable.toString()) + BigInt(pool.residual.toString());
  vault.writeBigUInt64LE(required, 64);
  map.set(pool.vault.toBase58(), info(vault, new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")));
  const signedResult = (request: Omit<SignSolanaTransactionRequest, "chain">): SignedResult => {
    const bytes = Buffer.from(request.transactionBase64, "base64");
    const tx = VersionedTransaction.deserialize(bytes); tx.sign([runtime]);
    return { schemaVersion: SIGNING_SCHEMA_VERSION, requestId: request.requestId, decision: "signed", payloadSha256: sha(bytes),
      signer: { role: "oracle-operator", address: runtime.publicKey.toBase58(), keyVersion: "version" },
      signature: Buffer.from(tx.signatures[0]!).toString("base64"), signedTransaction: Buffer.from(tx.serialize()).toString("base64"), decidedAt: Number(now) };
  };
  const signer = {
    signSolanaTransaction: async (request: Omit<SignSolanaTransactionRequest, "chain">) => {
      events.push("sign");
      assert.equal(state.pending?.unsignedBase64, request.transactionBase64);
      assert.equal(state.pending?.signedBase64, null);
      requests.push(structuredClone(request));
      const result = signedResult(request);
      if (loseSignerResponse) { loseSignerResponse = false; throw new Error("SignerResponseLost"); }
      return result;
    },
  } as unknown as RemoteSigner;
  const options: TransportOptions = { program, connection, poolId, policy, runtime: runtime.publicKey, genesisHash: "genesis", network: "devnet",
    keyVersion: "version", programSha256: "unused", computeUnitLimit: 600000, computeUnitPriceMicroLamports: 1, signer,
    preservePublication: async () => {}, clock: { nowSeconds: () => now }, store: { load: async () => structuredClone(state),
      save: async (next: PublisherState) => { events.push(next.pending?.signedBase64 ? "save-signed" : next.pending ? "save-unsigned" : "save-clear"); state = structuredClone(next); } } };
  const chain = new SolanaChain(options);
  const publish = (): Operation => ({ id: "operation", kind: "publish", batchId: BigInt(pool.lastBatch.toString()) + 1n,
    sequence: BigInt(pool.sequence.toString()) + 1n, predecessor: Buffer.from(pool.stateDigest).toString("hex"),
    revision: Buffer.from(pool.stateDigest).toString("hex"), snapshot: { cutoff: now - now % 60n, digest: "11".repeat(32), archiveTime: now,
      prices: batch.prices.map(p => ({ priceE8: BigInt(p.priceE8.toString()), venue: p.venue as PublishPrice["venue"], step: p.step as PublishPrice["step"],
        candleStart: BigInt(p.candleStart.toString()), tradeAgeMinutes: p.tradeAgeMinutes })) } });
  const stage = async (phase: 0 | 1 | 3, cursor = 0n) => {
    batch.pool = poolKey; batch.phase = phase; batch.batchId = pool.lastBatch.addn(1); batch.sequence = pool.sequence.addn(1);
    batch.cutoff = new anchor.BN((policy.origin + BigInt(batch.batchId.toString()) * 60n).toString());
    batch.predecessorSequence = pool.sequence; batch.predecessorDigest = pool.stateDigest;
    batch.cursor = new anchor.BN(cursor.toString()); batch.closedQueueEnd = new anchor.BN("1");
    pool.stage = pdas.batch(poolKey);
    await saveAccount("batch", batch, pool.stage); await saveAccount("pool", pool);
    const view = await chain.view();
    return { id: "crank", kind: "sealEvaluation" as const, batchId: view.stage!.batchId, sequence: view.stage!.sequence,
      revision: view.stage!.revision, predecessor: view.stateDigest, cursor };
  };
  return { chain, options, runtime, map, events, broadcasts, requests, publish, stage, signedResult, vault, required, pool, registry, saveAccount,
    state: () => state, setState: (s: PublisherState) => { state = s; },
    height: (n: number) => { height = n; }, status: (s: typeof status) => { status = s; },
    breakReads: (value: boolean) => { breakReads = value; }, loseSigner: () => { loseSignerResponse = true; },
    loseBroadcast: () => { loseBroadcastResponse = true; } };
}

test("persists unsigned before signing and signed bytes before broadcast", async () => {
  const s = await setup(); await s.chain.submit(s.publish());
  const events = s.events.filter(e => e !== "read");
  assert.deepEqual(events, ["save-unsigned", "sign", "save-signed", "broadcast"]);
  assert.equal(s.broadcasts.length, 1); assert.ok(s.state().pending?.signature);
});

test("lost signer response restarts with identical request identity and unsigned payload", async () => {
  const s = await setup(); s.loseSigner();
  await assert.rejects(s.chain.submit(s.publish()), /SignerResponseLost/);
  assert.equal(s.state().pending?.signedBase64, null);
  const restarted = new SolanaChain(s.options);
  assert.equal(await restarted.recover(), true);
  assert.deepEqual(s.requests[0], s.requests[1]);
  assert.equal(s.broadcasts.length, 1);
});

test("broadcast timeout replays identical signed bytes without signing again", async () => {
  const s = await setup(); s.loseBroadcast();
  await assert.rejects(s.chain.submit(s.publish()), /BroadcastTimeout/);
  assert.equal(await new SolanaChain(s.options).recover(), true);
  assert.equal(s.requests.length, 1); assert.equal(s.broadcasts.length, 2);
  assert.deepEqual(s.broadcasts[0], s.broadcasts[1]);
});

test("processed status remains pending before block expiry; finalized status clears", async () => {
  const s = await setup(); await s.chain.submit(s.publish());
  s.status({ confirmationStatus: "processed", err: null }); s.height(100);
  assert.equal(await s.chain.recover(), true); assert.ok(s.state().pending);
  assert.equal(s.broadcasts.length, 1);
  s.status({ confirmationStatus: "finalized", err: null });
  assert.equal(await s.chain.recover(), false); assert.equal(s.state().pending, null);
  assert.equal(s.state().lastOutcome, "transaction-finalized");
});

test("expiry requires a coherent finalized read before clearing pending", async () => {
  const s = await setup(); await s.chain.submit(s.publish()); s.height(101); s.breakReads(true);
  await assert.rejects(s.chain.recover(), /ReadUnavailable/); assert.ok(s.state().pending);
  s.breakReads(false);
  assert.equal(await s.chain.recover(), false); assert.equal(s.state().pending, null);
  assert.equal(s.state().lastOutcome, "transaction-expired-reconciled");
});

test("verifySigned rejects metadata, altered message and invalid signatures", async () => {
  const s = await setup(); s.loseSigner();
  await assert.rejects(s.chain.submit(s.publish()));
  const pending = s.state().pending!;
  const result = s.signedResult(s.requests[0]!);
  assert.ok(verifySigned(pending, result, s.runtime.publicKey).signature);
  for (const altered of [{ ...result, requestId: "other" }, { ...result, payloadSha256: "00".repeat(32) },
    { ...result, signer: { ...result.signer, keyVersion: "other" } }, { ...result, signature: Buffer.alloc(64).toString("base64") }])
    assert.throws(() => verifySigned(pending, altered, s.runtime.publicKey));
  const tx = VersionedTransaction.deserialize(Buffer.from(result.signedTransaction, "base64"));
  tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58(); tx.sign([s.runtime]);
  assert.throws(() => verifySigned(pending, { ...result, signedTransaction: Buffer.from(tx.serialize()).toString("base64"),
    signature: Buffer.from(tx.signatures[0]!).toString("base64") }, s.runtime.publicKey), /MessageMismatch/);
  const bad = VersionedTransaction.deserialize(Buffer.from(result.signedTransaction, "base64")); bad.signatures[0] = new Uint8Array(64);
  assert.throws(() => verifySigned(pending, { ...result, signedTransaction: Buffer.from(bad.serialize()).toString("base64"),
    signature: Buffer.alloc(64).toString("base64") }, s.runtime.publicKey), /SignatureInvalid/);
});

test("stage revision guards skip stale cursor and repeated safety pass operations", async () => {
  const s = await setup(); const first = await s.stage(3, 1n);
  await s.stage(3, 0n);
  await s.chain.submit(first); assert.equal(s.state().pending, null);
  const second = await s.stage(3, 1n);
  s.registry.paused = true; await s.saveAccount("registry", s.registry);
  await s.chain.submit(second); assert.equal(s.state().pending, null);
});

test("surplus tokens are allowed and collateral shortfall rejects", async () => {
  const s = await setup(); s.vault.writeBigUInt64LE(s.required + 1n, 64);
  await s.chain.view();
  assert.ok(s.required > 0n); s.vault.writeBigUInt64LE(s.required - 1n, 64);
  await assert.rejects(s.chain.view(), /VaultShortfall/);
});

test("paused recovery retains unsigned pending without requesting a signature", async () => {
  const s = await setup(); s.loseSigner();
  await assert.rejects(s.chain.submit(s.publish()), /SignerResponseLost/);
  s.registry.paused = true; await s.saveAccount("registry", s.registry);
  assert.equal(await new SolanaChain(s.options).recover(), true);
  assert.equal(s.requests.length, 1); assert.equal(s.broadcasts.length, 0); assert.ok(s.state().pending);
});

test("pending key-version mismatch cannot sign or broadcast", async () => {
  const s = await setup(); s.loseSigner();
  await assert.rejects(s.chain.submit(s.publish()));
  const state = s.state(); state.pending!.keyVersion = "other"; s.setState(state);
  await assert.rejects(s.chain.recover(), /PendingKeyVersionMismatch/);
  assert.equal(s.requests.length, 1); assert.equal(s.broadcasts.length, 0);
});

test("finalized transaction failure clears pending with explicit failed outcome", async () => {
  const s = await setup(); await s.chain.submit(s.publish());
  s.status({ confirmationStatus: "finalized", err: { InstructionError: [0, "Custom"] } });
  assert.equal(await s.chain.recover(), false);
  assert.equal(s.state().pending, null); assert.equal(s.state().lastOutcome, "transaction-failed");
});

test("crank guard rejects mismatched cursor, sequence, and phase even with current revision", async () => {
  const s = await setup(); const operation = await s.stage(3, 1n);
  for (const mismatched of [{ ...operation, cursor: 0n }, { ...operation, sequence: operation.sequence + 1n },
    { ...operation, kind: "finalize" as const }]) {
    await s.chain.submit(mismatched);
    assert.equal(s.state().pending, null);
  }
  assert.equal(s.requests.length, 0); assert.equal(s.broadcasts.length, 0);
});

test("cached signed bytes are reverified before rebroadcast", async () => {
  const s = await setup(); await s.chain.submit(s.publish());
  const state = s.state();
  const tx = VersionedTransaction.deserialize(Buffer.from(state.pending!.signedBase64!, "base64"));
  tx.signatures[0]![0] ^= 255;
  state.pending!.signedBase64 = Buffer.from(tx.serialize()).toString("base64");
  s.setState(state);
  await assert.rejects(new SolanaChain(s.options).recover());
  assert.equal(s.broadcasts.length, 1); assert.equal(s.requests.length, 1);
  assert.ok(s.state().pending);
});

test("nonfinal status at finalized expiry requires status requery and coherent read", async () => {
  const s = await setup(); await s.chain.submit(s.publish()); s.height(101);
  let queries = 0;
  s.options.connection.getSignatureStatuses = async () => {
    queries++; return { context: { slot: 7 }, value: [{ confirmationStatus: "processed", err: null, slot: 7, confirmations: 0 }] };
  };
  s.breakReads(true);
  await assert.rejects(s.chain.recover(), /ReadUnavailable/);
  assert.equal(queries, 2); assert.ok(s.state().pending);
  queries = 0; s.breakReads(false);
  assert.equal(await s.chain.recover(), false);
  assert.equal(queries, 2); assert.equal(s.state().pending, null);
  assert.equal(s.state().lastOutcome, "transaction-expired-reconciled");
});

test("status finalizing during expiry requery is recorded as finalized rather than expired", async () => {
  const s = await setup(); await s.chain.submit(s.publish()); s.height(101);
  let queries = 0;
  s.options.connection.getSignatureStatuses = async () => ({ context: { slot: 7 }, value: [{
    confirmationStatus: ++queries === 1 ? "confirmed" : "finalized", err: null, slot: 7, confirmations: null,
  }] });
  assert.equal(await s.chain.recover(), false); assert.equal(queries, 2);
  assert.equal(s.state().lastOutcome, "transaction-finalized");
});

async function initializedFixture() {
  const s = await setup();
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const programId = s.options.program.programId;
  const programData = PublicKey.findProgramAddressSync([programId.toBytes()], loader)[0];
  const executable = Buffer.alloc(36); executable.writeUInt32LE(2); programData.toBuffer().copy(executable, 4);
  s.map.set(programId.toBase58(), { ...info(executable, loader), executable: true });
  const binary = Buffer.from("reviewed-compiled-program");
  const data = Buffer.concat([Buffer.alloc(45), binary]); data.writeUInt32LE(3);
  s.map.set(programData.toBase58(), info(data, loader));
  const mint = Buffer.alloc(82); mint[44] = 6; mint[45] = 1;
  s.map.set(s.pool.collateralMint.toBase58(), info(mint, new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")));
  s.options.programSha256 = sha(binary);
  s.options.connection.getGenesisHash = async () => "genesis";
  const key: KeyDirectoryEntry = { role: "oracle-operator", state: "active", environment: "dev", chain: "solana", network: "devnet",
    algorithm: "ed25519", publicKey: s.runtime.publicKey.toBase58(), address: s.runtime.publicKey.toBase58(),
    keyVersion: "version", validFrom: 0, validUntil: null };
  s.options.signer.getPublicKey = async () => key;
  return { ...s, programData, key };
}

test("startup verifies network, executable identity and reviewed deployed build", async () => {
  const s = await initializedFixture(); await s.chain.initialize();
  assert.equal(s.requests.length, 0); assert.equal(s.broadcasts.length, 0);
  s.options.connection.getGenesisHash = async () => "other";
  await assert.rejects(s.chain.initialize(), /NetworkMismatch/);
  s.options.connection.getGenesisHash = async () => "genesis";
  const executable = s.map.get(s.options.program.programId.toBase58())!;
  executable.executable = false;
  await assert.rejects(s.chain.initialize(), /ProgramIdentityMismatch/);
  executable.executable = true;
  s.map.get(s.programData.toBase58())!.data[45] ^= 1;
  await assert.rejects(s.chain.initialize(), /DeployedBuildMismatch/);
});

test("startup requires active matching signer role, version, network and validity interval", async () => {
  const s = await initializedFixture();
  const original = { ...s.key };
  const mutations: Partial<KeyDirectoryEntry>[] = [
    { state: "revoked" }, { role: "solana-relayer" }, { keyVersion: "other" }, { network: "other" },
    { publicKey: PublicKey.default.toBase58() }, { algorithm: "secp256k1" }, { chain: "evm" },
    { validFrom: Number(s.options.clock.nowSeconds()) + 1 }, { validUntil: Number(s.options.clock.nowSeconds()) },
  ];
  for (const mutation of mutations) {
    Object.assign(s.key, original, mutation);
    await assert.rejects(s.chain.initialize(), /RuntimeKeyMismatch/);
  }
  Object.assign(s.key, original);
  await s.chain.initialize();
  assert.equal(s.requests.length, 0);
});

test("startup rejects collateral mint with wrong decimals, initialization or token owner", async () => {
  const s = await initializedFixture();
  const mint = s.map.get(s.pool.collateralMint.toBase58())!;
  mint.data[44] = 9;
  await assert.rejects(s.chain.initialize(), /CollateralMintMismatch/);
  mint.data[44] = 6; mint.data[45] = 0;
  await assert.rejects(s.chain.initialize(), /CollateralMintMismatch/);
  mint.data[45] = 1; mint.owner = PublicKey.default;
  await assert.rejects(s.chain.initialize(), /CollateralMintMismatch/);
});

test("archive failure blocks signing and preserves the unsigned transaction for retry", async () => {
  const s = await setup();
  let calls = 0;
  s.options.preservePublication = async () => { calls++; throw new Error("ArchiveDiskFailure"); };
  await assert.rejects(s.chain.submit(s.publish()), /ArchiveDiskFailure/);
  assert.equal(calls, 1); assert.equal(s.requests.length, 0); assert.equal(s.broadcasts.length, 0);
  assert.equal(s.state().pending?.signedBase64, null);
  const pending = structuredClone(s.state().pending);
  await assert.rejects(new SolanaChain(s.options).recover(), /ArchiveDiskFailure/);
  assert.deepEqual(s.state().pending, pending); assert.equal(s.requests.length, 0);
  s.options.preservePublication = async () => {};
  assert.equal(await new SolanaChain(s.options).recover(), true);
  assert.equal(s.requests.length, 1); assert.equal(s.broadcasts.length, 1);
});

test("archive failure blocks rebroadcast of persisted signed bytes after restart", async () => {
  const s = await setup(); await s.chain.submit(s.publish());
  const pending = structuredClone(s.state().pending);
  s.options.preservePublication = async () => { throw new Error("ArchiveUnavailable"); };
  await assert.rejects(new SolanaChain(s.options).recover(), /ArchiveUnavailable/);
  assert.deepEqual(s.state().pending, pending);
  assert.equal(s.requests.length, 1); assert.equal(s.broadcasts.length, 1);
  s.options.preservePublication = async () => {};
  assert.equal(await new SolanaChain(s.options).recover(), true);
  assert.equal(s.requests.length, 1); assert.equal(s.broadcasts.length, 2);
  assert.deepEqual(s.broadcasts[0], s.broadcasts[1]);
});

test("publication is archived before signing with exact account bytes and finalized slot", async () => {
  const s = await setup();
  const publicationKey = addresses(s.options.program.programId).publication(addresses(s.options.program.programId).pool(s.options.poolId));
  let calls = 0;
  s.options.preservePublication = async (observed, slot) => {
    calls++;
    assert.equal(s.requests.length, 0); assert.equal(s.broadcasts.length, 0);
    assert.equal(slot, 7);
    assert.deepEqual(observed.data, s.map.get(publicationKey.toBase58())!.data);
  };
  await s.chain.submit(s.publish());
  assert.equal(calls, 1); assert.equal(s.requests.length, 1);
});

test("pool and latest-publication mismatch blocks signing and archival", async () => {
  const s = await setup();
  let calls = 0; s.options.preservePublication = async () => { calls++; };
  const publicationKey = addresses(s.options.program.programId).publication(addresses(s.options.program.programId).pool(s.options.poolId));
  const observed = s.map.get(publicationKey.toBase58())!;
  const publication = decodeAccount(s.options.program, "publication", observed);
  s.pool.sequence = s.pool.sequence.addn(1); await s.saveAccount("pool", s.pool);
  await assert.rejects(s.chain.submit(s.publish()), /PublicationPoolMismatch/);
  assert.equal(calls, 0); assert.equal(s.requests.length, 0);
  s.pool.sequence = publication.sequence;
  s.pool.stateDigest = Array(32).fill(1); await s.saveAccount("pool", s.pool);
  s.setState({ ...s.state(), pending: null });
  await assert.rejects(s.chain.submit(s.publish()), /PublicationPoolMismatch/);
  assert.equal(calls, 0); assert.equal(s.broadcasts.length, 0);
});
