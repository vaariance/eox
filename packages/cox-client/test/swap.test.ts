import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import anchor, { type Idl } from "@coral-xyz/anchor";
import { PublicKey, SYSVAR_CLOCK_PUBKEY, type AccountInfo, type Connection, type VersionedTransaction } from "@solana/web3.js";
import { build } from "esbuild";
import { CoxSwapSdk, DEVNET_TEST_COLLATERAL, type SwapPlan } from "../src/swap.ts";
import { addresses } from "../src/pdas.ts";
import { decodeAccount } from "../src/readers.ts";
import type { Accounts } from "../src/accounts.ts";

const idl = JSON.parse(readFileSync(new URL("../../cox/idl/cox.json", import.meta.url), "utf8")) as Idl;
const fixtures = JSON.parse(readFileSync(new URL("../../cox/fixtures/accounts.json", import.meta.url), "utf8")) as {
  accounts: { name: keyof Accounts; address: string; owner: string; dataHex: string }[];
};
const bn = (value: bigint | number) => new anchor.BN(value.toString());
const account = (data: Buffer, owner: PublicKey): AccountInfo<Buffer> => ({ data, owner, executable: false, lamports: 100000000, rentEpoch: 0 });
function setup() {
  const map = new Map<string, AccountInfo<Buffer>>();
  for (const fixture of fixtures.accounts) map.set(fixture.address, account(Buffer.from(fixture.dataHex, "hex"), new PublicKey(fixture.owner)));
  let genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  let quoteSequence: anchor.BN | null = null;
  const quoteInstructions: { operation: number; from: number; to: number }[] = [];
  const connection = {
    getGenesisHash: async () => genesis,
    getAccountInfo: async (key: PublicKey) => map.get(key.toBase58()) ?? null,
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({ context: { slot: 100 }, value: keys.map(key => map.get(key.toBase58()) ?? null) }),
    getLatestBlockhash: async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1000 }),
    simulateTransaction: async (transaction: VersionedTransaction) => {
      const instruction = new anchor.BorshInstructionCoder(program.idl).decode(Buffer.from(transaction.message.compiledInstructions[0]!.data))!;
      assert.equal(instruction.name, "quoteRequest");
      quoteInstructions.push(instruction.data as { operation: number; from: number; to: number });
      return { value: { err: null, returnData: { programId: program.programId.toBase58(),
        data: [program.coder.types.encode("quoteRead", { sequence: quoteSequence ?? pool.sequence, minted: bn(2000000000000000000n), proceeds: bn(2000000n) }).toString("base64"), "base64"] } } };
    },
  } as unknown as Connection;
  const program = new anchor.Program(idl, { connection });
  const get = <K extends keyof Accounts>(name: K): Accounts[K] => {
    const fixture = fixtures.accounts.find(value => value.name === name)!;
    return decodeAccount(program, name, map.get(fixture.address)!);
  };
  const put = <K extends keyof Accounts>(name: K, key: PublicKey, value: Accounts[K]) => {
    const coder = program.coder.accounts as unknown as { accountLayouts: Map<string, { layout: { encode(value: unknown, bytes: Buffer): number }; discriminator: number[] }> };
    const entry = coder.accountLayouts.get(name)!;
    const bytes = Buffer.alloc(name === "request" ? 320 : 4096);
    Buffer.from(entry.discriminator).copy(bytes);
    entry.layout.encode(name === "methodology" ? { ...value, canonical: Buffer.from((value as Accounts["methodology"]).canonical) } : value, bytes.subarray(8));
    map.set(key.toBase58(), account(bytes, program.programId));
  };
  const pool = get("pool");
  const poolId = BigInt(pool.poolId.toString());
  const pdas = addresses(program.programId);
  const poolKey = pdas.pool(poolId);
  const position = get("position");
  const owner = position.owner;
  const tokenAccount = new PublicKey(new Uint8Array(32).fill(44));
  const token = Buffer.alloc(165);
  pool.collateralMint.toBuffer().copy(token); owner.toBuffer().copy(token, 32);
  token.writeBigUInt64LE(100000000n, 64); token[108] = 1;
  map.set(tokenAccount.toBase58(), account(token, new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")));
  const vault = Buffer.from(token); poolKey.toBuffer().copy(vault, 32);
  vault.writeBigUInt64LE(BigInt(pool.active.toString()) + BigInt(pool.pending.toString()) + BigInt(pool.payable.toString()) + BigInt(pool.residual.toString()), 64);
  map.set(pool.vault.toBase58(), account(vault, new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")));
  const mint = Buffer.alloc(82); mint[44] = 6; mint[45] = 1;
  map.set(pool.collateralMint.toBase58(), account(mint, new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")));
  const clock = Buffer.alloc(40);
  const now = BigInt(pool.origin.toString()) + BigInt(pool.lastBatch.toString()) * 60n + 5n;
  clock.writeBigInt64LE(now, 32);
  map.set(SYSVAR_CLOCK_PUBKEY.toBase58(), account(clock, PublicKey.default));
  const sdk = new CoxSwapSdk(program, { poolId, collateralMint: pool.collateralMint });
  const expiry = BigInt(pool.lastBatch.toString()) + 10n;
  const buy = { owner, tokenAccount, amount: 2000000n, minimumUnits: 1n, expiryBatch: expiry };
  const decode = (plan: SwapPlan) => new anchor.BorshInstructionCoder(program.idl).decode(plan.instructions[0]!.data)!;
  return { sdk, program, pool, poolId, poolKey, pdas, position, owner, tokenAccount, map, put, get, now, buy, decode, quoteInstructions,
    setGenesis: (value: string) => { genesis = value; }, setQuoteSequence: (value: anchor.BN) => { quoteSequence = value; } };
}

test("benchmark buy reserves collateral with the exact deployed ABI and an unsigned wallet transaction", async () => {
  const s = setup();
  const plan = await s.sdk.prepareBuy(s.buy);
  const instruction = s.decode(plan);
  assert.equal(plan.kind, "buy-crypto"); assert.equal(plan.testOnly, true);
  assert.equal(instruction.name, "deposit");
  const data = instruction.data as { to: number; amount: anchor.BN; minimumUnits: anchor.BN; expiry: anchor.BN };
  assert.equal(data.to, s.pool.classes.length - 1); assert.equal(data.amount.toString(), "2000000");
  assert.equal(data.minimumUnits.toString(), "1"); assert.equal(data.expiry.toString(), s.buy.expiryBatch.toString());
  assert.ok(plan.request!.address.equals(s.pdas.request(s.poolKey, BigInt(s.pool.nextRequestNonce.toString()))));
  assert.ok(plan.request!.earliestBatchEstimate > BigInt(s.pool.lastBatch.toString()));
  const transaction = await s.sdk.transaction(plan);
  assert.equal(transaction.transaction.message.header.numRequiredSignatures, 1);
  assert.ok(transaction.transaction.message.staticAccountKeys[0]!.equals(s.owner));
  assert.ok(transaction.transaction.signatures[0]!.every(byte => byte === 0));
  assert.ok(transaction.transaction.serialize().length <= 1232);
});

test("sell uses only the final CRYPTO class; receipt proceeds require a separate withdrawal", async () => {
  const s = setup();
  s.position.staged = false;
  s.position.classes[s.pool.classes.length - 1] = { units: bn(5000000000000n), locked: bn(1000000000000n) };
  s.position.payable = bn(3000000n);
  s.put("position", s.pdas.position(s.poolKey, s.owner), s.position);
  const sell = await s.sdk.prepareSell({ owner: s.owner, tokenAccount: s.tokenAccount, units: 2000000000000n, minimumProceeds: 10n, expiryBatch: s.buy.expiryBatch });
  const instruction = s.decode(sell);
  assert.equal(instruction.name, "redeem");
  assert.equal((instruction.data as { from: number }).from, s.pool.classes.length - 1);
  assert.equal(sell.instructions.length, 1);
  const withdrawal = await s.sdk.prepareWithdraw({ owner: s.owner, tokenAccount: s.tokenAccount, amount: 3000000n });
  assert.equal(s.decode(withdrawal).name, "withdraw"); assert.equal(withdrawal.request, null);
  await assert.rejects(s.sdk.prepareWithdraw({ owner: s.owner, tokenAccount: s.tokenAccount, amount: 3000001n }), /SwapInsufficientPayable/);
  await assert.rejects(s.sdk.prepareSell({ owner: s.owner, tokenAccount: s.tokenAccount, units: 4000000000001n, minimumProceeds: 0n, expiryBatch: s.buy.expiryBatch }), /SwapInsufficientUnlockedUnits/);
});

test("asset-zero units cannot fund a benchmark redemption or appear in benchmark balances", async () => {
  const s = setup();
  s.position.staged = false;
  s.position.classes = s.pool.classes.map(() => ({ units: bn(0), locked: bn(0) }));
  s.position.classes[0] = { units: bn(5000000000000n), locked: bn(0) };
  s.put("position", s.pdas.position(s.poolKey, s.owner), s.position);
  assert.equal((await s.sdk.balances(s.owner)).availableUnits, 0n);
  await assert.rejects(s.sdk.prepareSell({ owner: s.owner, tokenAccount: s.tokenAccount, units: 1n, minimumProceeds: 0n, expiryBatch: s.buy.expiryBatch }), /SwapInsufficientUnlockedUnits/);
  s.position.classes[s.pool.classes.length - 1] = { units: bn(300n), locked: bn(100n) };
  s.put("position", s.pdas.position(s.poolKey, s.owner), s.position);
  assert.equal((await s.sdk.balances(s.owner)).availableUnits, 200n);
});

test("staged CRYPTO units and proceeds become spendable only after global finalization", async () => {
  const s = setup();
  const sequence = s.pool.sequence.addn(1);
  s.position.appliedSequence = s.pool.sequence;
  s.position.staged = true; s.position.stagedSequence = sequence;
  s.position.payable = bn(0);
  s.position.classes = s.pool.classes.map(() => ({ units: bn(0), locked: bn(0) }));
  s.position.stagedBurns = s.pool.classes.map(() => bn(0));
  s.position.stagedMints = s.pool.classes.map((_, i) => bn(i === s.pool.classes.length - 1 ? 2000000000000n : 0));
  s.position.stagedUnlocks = s.pool.classes.map(() => bn(0));
  s.position.stagedPayable = bn(2000000); s.position.stagedRefundable = bn(0);
  s.put("position", s.pdas.position(s.poolKey, s.owner), s.position);
  assert.equal((await s.sdk.balances(s.owner)).availableUnits, 0n);
  await assert.rejects(s.sdk.prepareWithdraw({ owner: s.owner, tokenAccount: s.tokenAccount, amount: 1n }), /SwapInsufficientPayable/);
  s.pool.sequence = sequence; s.put("pool", s.poolKey, s.pool);
  assert.equal((await s.sdk.balances(s.owner)).availableUnits, 2000000000000n);
  assert.equal((await s.sdk.balances(s.owner)).payable, 2000000n);
});

test("pool-wide nonce races require rebuilding; quotes never promise the later fill value", async () => {
  const s = setup();
  const plan = await s.sdk.prepareBuy(s.buy);
  s.pool.nextRequestNonce = s.pool.nextRequestNonce.addn(1); s.put("pool", s.poolKey, s.pool);
  await assert.rejects(s.sdk.transaction(plan), /SwapNonceChangedRebuild/);
  const quote = await s.sdk.quoteBuy(s.owner, 2000000n);
  assert.equal(quote.estimatedOutput, 2000000000000000000n);
  assert.equal(quote.guaranteed, false); assert.equal(quote.execution, "future-publication");
  assert.equal((await s.sdk.quoteSell(s.owner, 2000000000000000000n)).estimatedOutput, 2000000n);
  assert.deepEqual(s.quoteInstructions.map(({ operation, from, to }) => ({ operation, from, to })), [
    { operation: 0, from: 255, to: s.pool.classes.length - 1 },
    { operation: 2, from: s.pool.classes.length - 1, to: 255 },
  ]);
  s.setQuoteSequence(s.pool.sequence.addn(1));
  await assert.rejects(s.sdk.quoteBuy(s.owner, 2000000n), /SwapReadChangedRetry/);
});

test("wrong collateral, network, ownership, precision and paused/uninitialized pools fail before wallet signing", async () => {
  const s = setup();
  const wrongMint = new CoxSwapSdk(s.program, { poolId: s.poolId, collateralMint: DEVNET_TEST_COLLATERAL });
  await assert.rejects(wrongMint.market(), /SwapSetupMissing|SwapCollateralMismatch/);
  s.setGenesis("mainnet"); await assert.rejects(s.sdk.prepareBuy(s.buy), /SwapNetworkMismatch/);
  s.setGenesis("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  await assert.rejects(s.sdk.prepareBuy({ ...s.buy, amount: 0n }), /InvalidSwapAmount/);
  await assert.rejects(s.sdk.prepareBuy({ ...s.buy, amount: 1.1 as unknown as bigint }), /InvalidSwapAmount/);
  await assert.rejects(s.sdk.prepareBuy({ ...s.buy, owner: PublicKey.default }), /SwapWalletTokenMismatch/);
  await assert.rejects(s.sdk.prepareBuy({ ...s.buy, expiryBatch: 0n }), /SwapExpiryTooEarly/);
  s.pool.initialized = false; s.put("pool", s.poolKey, s.pool);
  await assert.rejects(s.sdk.prepareBuy(s.buy), /SwapPoolNotInitialized/);
  s.pool.initialized = true; s.put("pool", s.poolKey, s.pool);
  const registry = s.get("registry"); registry.paused = true; s.put("registry", s.pdas.registry(), registry);
  await assert.rejects(s.sdk.prepareBuy(s.buy), /SwapPaused/);
});

test("request visibility, safety rejection and explicit refunds use committed states", async () => {
  const s = setup();
  const request = s.get("request");
  request.owner = s.owner; request.operation = 0; request.to = s.pool.classes.length - 1; request.from = 255;
  request.status = 0; request.applied = true; request.receiptStatus = 4;
  request.boundSequence = s.pool.sequence.addn(1); request.amount = bn(2000000n);
  request.minted = bn(999); request.proceeds = bn(999);
  const nonce = BigInt(request.nonce.toString());
  s.put("request", s.pdas.request(s.poolKey, nonce), request);
  assert.equal((await s.sdk.request(s.owner, nonce)).status, "queued");
  assert.equal((await s.sdk.request(s.owner, nonce)).mintedUnits, 0n);
  await assert.rejects(s.sdk.request(PublicKey.default, nonce), /SwapRequestOwnerMismatch/);
  s.pool.sequence = request.boundSequence; s.put("pool", s.poolKey, s.pool);
  s.position.staged = false; s.position.refundable = request.amount;
  s.put("position", s.pdas.position(s.poolKey, s.owner), s.position);
  const status = await s.sdk.request(s.owner, nonce);
  assert.equal(status.status, "safety-rejected"); assert.equal(status.refundRequired, true);
  const plan = await s.sdk.prepareRefund({ owner: s.owner, tokenAccount: s.tokenAccount, nonce });
  assert.equal(s.decode(plan).name, "refund");
  request.status = 6; s.put("request", s.pdas.request(s.poolKey, nonce), request);
  await assert.rejects(s.sdk.prepareRefund({ owner: s.owner, tokenAccount: s.tokenAccount, nonce }), /SwapNotRefundable/);
});

test("accepted requests cannot be cancelled or expired even after a minute", async () => {
  const s = setup();
  const request = s.get("request");
  request.owner = s.owner; request.operation = 0; request.to = s.pool.classes.length - 1; request.from = 255;
  request.status = 0; request.applied = false; request.evaluated = false;
  request.targetBatch = s.pool.lastBatch.addn(1); request.expiryBatch = request.targetBatch.addn(1);
  const nonce = BigInt(request.nonce.toString());
  s.put("request", s.pdas.request(s.poolKey, nonce), request);
  assert.equal(s.decode(await s.sdk.prepareCancel(s.owner, nonce)).name, "cancel");
  s.pool.stage = s.pdas.batch(s.poolKey); s.pool.stageBatch = request.targetBatch; s.pool.stageClosedEnd = request.nonce.addn(1);
  s.put("pool", s.poolKey, s.pool);
  const clock = s.map.get(SYSVAR_CLOCK_PUBKEY.toBase58())!;
  clock.data.writeBigInt64LE(s.now + 180n, 32);
  await assert.rejects(s.sdk.prepareCancel(s.owner, nonce), /SwapCancellationClosed/);
  await assert.rejects(s.sdk.prepareExpire(s.owner, nonce), /SwapCancellationClosed/);
});

test("swap entry point bundles for browsers without Node built-ins or service signer code", async () => {
  const result = await build({ entryPoints: [new URL("../src/swap.ts", import.meta.url).pathname], bundle: true,
    platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent" });
  const inputs = Object.keys(result.metafile!.inputs);
  assert.ok(!inputs.some(path => /packages\/signing|cox-publisher|cox-methodology/.test(path)));
  assert.ok(result.outputFiles[0]!.text.length > 0);
  assert.ok(!result.outputFiles[0]!.text.includes('from "node:crypto"'));
});

test("compiled-program asset-zero receipt is refused as a benchmark swap", async () => {
  const s = setup();
  const receipt = s.get("request");
  assert.equal(receipt.operation, 0); assert.equal(receipt.to, 0);
  assert.equal(receipt.amount.toString(), "1000000");
  await assert.rejects(s.sdk.request(receipt.owner, BigInt(receipt.nonce.toString())), /SwapRequestNotBenchmark/);
  assert.equal((await s.sdk.market()).cryptoClass, s.pool.classes.length - 1);
  assert.equal((await s.sdk.market()).cryptoUnitDecimals, 12);
});
