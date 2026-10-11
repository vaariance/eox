import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import { discriminator } from "@cox/client";
import type { AddressInfo } from "node:net";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type AccountInfo, type Connection } from "@solana/web3.js";
import { createCoxApiClient, type Publication, type UnsignedTransaction } from "@eox/app-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProgram } from "../src/cox/chain.js";
import { LiveCoxSource } from "../src/cox/live-source.js";
import { PublicationLog } from "../src/cox/publication-log.js";
import { createCoxApiServer } from "../src/cox/server.js";
import { CoxSubmissions } from "../src/cox/submissions.js";
import { associatedTokenAddress, CoxTransactions } from "../src/cox/transactions.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const idlPath = join(root, "packages", "cox", "idl", "cox.json");
const fixture = JSON.parse(readFileSync(join(root, "packages", "cox", "fixtures", "accounts.json"), "utf8")) as {
  programAddress: string;
  accounts: Record<string, { address: string; dataHex: string; name: string; owner: string }>;
};
const POOL = "Fn3Xuh7CVxjcRpqJEnGR1isPy2GVBBsdiAbuhfpoVbHb";
const VAULT = "6Z7NdtAx71cmySoSYMDm697UCQcuuVYj39yPFsh2nWQ8";
const MINT = "EHabPa4wojMHYfs9vwy77oEcpazRY5m7qHwgEa3Cx2kz";
const OWNER = "5JZscCkA2m4GrBDLEjxk3ZKuysw1LGsBQoPq4kY2XBvs";
const REQUEST = "H6wVPbPg4N3qsTyCWyYuuDfWhUUeGTBp2eGiZWuvXQG7";
const PREDECESSOR = "16ff39cb1381a652e992d9b42bc2d5b5d74889bacaa6c03ad1d75c8e9a0b151b";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

class FixtureConnection {
  readonly accounts = new Map<string, AccountInfo<Buffer>>();
  readonly signatures = new Map<string, { signature: string; slot: number; err: null }[]>();
  readonly sent: Buffer[] = [];
  simulationError: string | null = null;
  status: { slot: number; confirmationStatus: string; err: unknown } | null = null;

  async getLatestBlockhash() {
    return { blockhash: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", lastValidBlockHeight: 4242 };
  }

  async simulateTransaction() {
    if (!this.simulationError) return { context: { slot: 1 }, value: { err: null, logs: [] } };
    return { context: { slot: 1 }, value: { err: { InstructionError: [0, { Custom: 6000 }] }, logs: [`Program log: AnchorError occurred. Error Message: ${this.simulationError}.`] } };
  }

  async sendRawTransaction(bytes: Buffer) {
    this.sent.push(Buffer.from(bytes));
    return anchor.utils.bytes.bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]!);
  }

  async getSignatureStatuses() {
    return { context: { slot: 1 }, value: [this.status] };
  }

  async isBlockhashValid() {
    return { context: { slot: 1 }, value: false };
  }

  set(address: string, owner: PublicKey, data: Buffer): void {
    this.accounts.set(address, { data, owner, executable: false, lamports: 1, rentEpoch: 0 });
  }

  async getAccountInfo(key: PublicKey) {
    return this.accounts.get(key.toBase58()) ?? null;
  }

  async getMultipleAccountsInfoAndContext(keys: PublicKey[]) {
    return { context: { slot: 1 }, value: keys.map((k) => this.accounts.get(k.toBase58()) ?? null) };
  }

  async getProgramAccounts(programId: PublicKey, config: { filters: { memcmp: { offset: number; bytes: string } }[] }) {
    return [...this.accounts.entries()]
      .filter(([, info]) => info.owner.equals(programId))
      .filter(([, info]) => config.filters.every(({ memcmp }) => {
        const bytes = Buffer.from(anchor.utils.bytes.bs58.decode(memcmp.bytes));
        return info.data.subarray(memcmp.offset, memcmp.offset + bytes.length).equals(bytes);
      }))
      .map(([address, account]) => ({ pubkey: new PublicKey(address), account }));
  }

  async getSignaturesForAddress(key: PublicKey) {
    return this.signatures.get(key.toBase58()) ?? [];
  }
}

function tokenAccount(mint: string, amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(data, 0);
  new PublicKey(POOL).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}

function mintAccount(decimals: number): Buffer {
  const data = Buffer.alloc(82);
  data[44] = decimals;
  data[45] = 1;
  return data;
}

function originEntry(): Publication {
  return {
    identity: {
      program: fixture.programAddress, poolId: "0", sequence: 0, batch: 0, predecessorSequence: null, predecessorBatch: null, missedBatches: [], cutoff: 120000,
      manifestDigest: null, snapshotDigest: null, stateDigest: PREDECESSOR, committedAt: null, finalization: { transaction: null, slot: null, finalized: true },
    },
    prices: [], benchmarkGross: null, benchmark: "100000000000000", references: [], classes: [],
    flows: { acceptedDeposits: "0", newPayable: "0", transferResidual: "0", flowResidual: "0", executed: 0, rejected: 0 },
    ledger: { active: "0", pending: "0", refundable: null, payable: "0", residual: "0", vault: "0" },
    receiptRoot: null,
  };
}

let dir = "";
let connection: FixtureConnection;
let ledger = 0n;

function open(logPath = join(dir, "publications.jsonl"), poolId = 0n) {
  const program = loadProgram(connection as unknown as Connection, idlPath);
  return LiveCoxSource.open({ connection: connection as unknown as Connection, program, poolId, network: "solana-devnet", logPath });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cox-live-"));
  connection = new FixtureConnection();
  const programId = new PublicKey(fixture.programAddress);
  for (const account of Object.values(fixture.accounts)) connection.set(account.address, new PublicKey(account.owner), Buffer.from(account.dataHex, "hex"));
  const program = loadProgram(connection as unknown as Connection, idlPath);
  const pool = program.coder.accounts.decode("pool", connection.accounts.get(POOL)!.data);
  ledger = [pool.active, pool.pending, pool.payable, pool.residual].reduce((sum: bigint, v: { toString(): string }) => sum + BigInt(v.toString()), 0n);
  connection.set(VAULT, TOKEN_PROGRAM, tokenAccount(MINT, ledger));
  connection.set(MINT, TOKEN_PROGRAM, mintAccount(6));
  const publication = Object.values(fixture.accounts).find((a) => a.name === "publication")!.address;
  connection.signatures.set(publication, [{ signature: "finalize-signature", slot: 509739999, err: null }]);
  expect(programId.toBase58()).toBe("G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("live COX source on the compiled-program account fixtures", () => {
  it("describes the deployment from the pool, its sealed methodology and the collateral mint", async () => {
    const source = await open();
    expect(await source.deployment()).toMatchObject({
      origin: "live", network: "solana-devnet", program: fixture.programAddress, poolId: "0", poolAddress: POOL, collateralMint: MINT, collateralDecimals: 6, testCollateral: true,
      methodology: { status: "sealed", assetCount: 30, label: "CRYPTO (pilot, 30 assets)", digest: "6022696ff185464c4787369d0de7f4bc075bfa4933aa9669b7de493f95edc113" },
    });
    const crypto = await source.crypto();
    expect(crypto.members).toHaveLength(30);
    expect(crypto.members[0]).toEqual({ assetId: "BTC", weightNumerator: "1", weightDenominator: "30" });
    const assets = await source.assets();
    expect(assets.find((a) => a.assetId === "TRX")?.venues).toEqual({ krakenWs: "TRX/USD", krakenRest: "TRXUSD", coinbase: null, bybit: "TRXUSDT" });
    expect(assets.every((a) => a.latest === null)).toBe(true);
  });

  it("indexes the next finalized publication after the durable log and links it to its predecessor", async () => {
    new PublicationLog(join(dir, "publications.jsonl"), { program: fixture.programAddress, pool: POOL }).append(originEntry());
    const source = await open();
    const seen: Publication[] = [];
    source.onPublication((p) => seen.push(p));
    await source.tick();
    const [, latest] = await source.publications();
    expect(seen).toEqual([latest]);
    expect(latest!.identity).toMatchObject({
      sequence: 1, batch: 1, predecessorSequence: 0, predecessorBatch: 0, missedBatches: [], cutoff: 120060,
      stateDigest: "2c4a985999c699a43113063883c2fb2856c4d5e53dfaaf0d98dddde8ce7a0583",
      manifestDigest: "6022696ff185464c4787369d0de7f4bc075bfa4933aa9669b7de493f95edc113",
      finalization: { transaction: "finalize-signature", slot: 509739999, finalized: true },
    });
    expect(latest!.prices).toHaveLength(30);
    expect(latest!.prices[0]).toEqual({ assetId: "BTC", priceE8: "100000000", venue: "kraken", step: 1, candleStart: 120000, tradeAgeMinutes: 0 });
    expect(latest!.classes.map((c) => c.classId).at(-1)).toBe("CRYPTO");
    expect(latest!.classes).toHaveLength(31);
    const { active, pending, payable, residual, vault } = latest!.ledger;
    expect(BigInt(active) + BigInt(pending) + BigInt(payable) + BigInt(residual)).toBe(BigInt(vault));
    expect(latest!.ledger.refundable).toBeNull();
    const status = await source.status(120060 + 25);
    expect(status).toMatchObject({ state: "fresh", latestSequence: 1, latestBatch: 1, missedCutoffs: 0, executing: false, reconciliation: { sequence: 1, vault: ledger.toString(), ledger: ledger.toString(), covered: true } });
    expect((await source.assets())[0]!.latest).toMatchObject({ sequence: 1, batch: 1, priceE8: "100000000" });
    const reopened = await open();
    expect((await reopened.publications()).map((p) => p.identity.sequence)).toEqual([0, 1]);
  });

  it("reports an incident when the vault holds less than the ledger", async () => {
    new PublicationLog(join(dir, "publications.jsonl"), { program: fixture.programAddress, pool: POOL }).append(originEntry());
    connection.set(VAULT, TOKEN_PROGRAM, tokenAccount(MINT, ledger - 1n));
    const source = await open();
    await source.tick();
    expect(await source.status(120060 + 25)).toMatchObject({ state: "incident", reconciliation: { covered: false } });
  });

  it("refuses a publication that does not follow the logged predecessor", async () => {
    const wrong = originEntry();
    wrong.identity.stateDigest = "00".repeat(32);
    new PublicationLog(join(dir, "publications.jsonl"), { program: fixture.programAddress, pool: POOL }).append(wrong);
    const source = await open();
    await expect(source.tick()).rejects.toThrow("PublicationPredecessorMismatch");
    expect(await source.publications()).toHaveLength(1);
  });

  it("serves a wallet's committed position and its filled request from chain state", async () => {
    const source = await open();
    const portfolio = await source.portfolio(OWNER);
    expect(portfolio).toMatchObject({ owner: OWNER, appliedSequence: 1, payable: "0", refundable: "0", pending: "0" });
    expect(portfolio!.positions).toHaveLength(31);
    expect(portfolio!.positions[0]).toEqual({ classId: "BTC", units: "2000000000000000000", locked: "0" });
    expect(portfolio!.requests).toEqual([{
      requestId: REQUEST, owner: OWNER, operation: "deposit", fromClass: null, toClass: "BTC", amount: "1000000", units: null, minimumUnits: "0", minimumProceeds: null,
      targetBatch: 1, expiryBatch: 20, state: "filled",
      receipt: { requestId: REQUEST, sequence: 1, batch: 1, status: "filled", minted: "1000000000000000000", proceeds: "0" },
    }]);
    expect(await source.portfolio("11111111111111111111111111111111")).toBeNull();
  });
});

describe("publication log", () => {
  it("drops a partly written last line and refuses a log from another pool", () => {
    const path = join(dir, "log.jsonl");
    new PublicationLog(path, { program: fixture.programAddress, pool: POOL }).append(originEntry());
    appendFileSync(path, '{"identity":{"seq');
    const log = new PublicationLog(path, { program: fixture.programAddress, pool: POOL });
    expect(log.nextSequence).toBe(1);
    log.append({ ...originEntry(), identity: { ...originEntry().identity, sequence: 1, batch: 2, predecessorBatch: 0 } });
    expect(new PublicationLog(path, { program: fixture.programAddress, pool: POOL }).all.map((p) => p.identity.batch)).toEqual([0, 2]);
    expect(() => new PublicationLog(path, { program: fixture.programAddress, pool: VAULT })).toThrow("another program or pool");
    expect(() => log.append({ ...originEntry(), identity: { ...originEntry().identity, sequence: 3 } })).toThrow("out of order");
  });
});

describe("unsigned transactions and submission", () => {
  const wallet = Keypair.generate();
  const NOW = 120000 + 60 * 5 + 10;

  async function services() {
    const source = await open();
    const program = loadProgram(connection as unknown as Connection, idlPath);
    const transactions = new CoxTransactions({
      connection: connection as unknown as Connection, program, poolId: 0n, pool: source.poolAddress, vault: source.vaultAddress, mint: source.collateralMint, origin: source.manifest.origin, classes: source.classes,
    }, () => NOW);
    const submissions = new CoxSubmissions({ connection: connection as unknown as Connection, programId: program.programId, path: join(dir, "submissions.json"), now: () => NOW });
    return { source, program, transactions, submissions };
  }

  function decode(built: UnsignedTransaction) {
    const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
    const keys = tx.message.staticAccountKeys;
    return { tx, keys, instructions: tx.message.compiledInstructions.map((i) => ({ program: keys[i.programIdIndex]!.toBase58(), accounts: i.accountKeyIndexes.map((k) => keys[k]!.toBase58()), data: Buffer.from(i.data) })) };
  }

  it("builds a deposit for the next request nonce, paid and signed by the wallet only", async () => {
    const { program, transactions } = await services();
    const pool = program.coder.accounts.decode("pool", connection.accounts.get(POOL)!.data);
    const nonce = BigInt(pool.nextRequestNonce.toString());
    const built = await transactions.deposit({ owner: wallet.publicKey.toBase58(), toClass: "ETH", amount: "2500000", minimumUnits: "0", expiryBatch: 10 });
    const request = PublicKey.findProgramAddressSync([Buffer.from("request"), new PublicKey(POOL).toBuffer(), Buffer.from(new BigUint64Array([nonce]).buffer)], program.programId)[0];
    expect(built).toMatchObject({ operation: "deposit", owner: wallet.publicKey.toBase58(), nonce: nonce.toString(), requestId: request.toBase58(), targetBatch: { batch: 6, cutoff: 120360 }, expiryBatch: 10, toClass: "ETH", amount: "2500000", minimumUnits: "0", lastValidBlockHeight: 4242 });
    const { tx, keys, instructions } = decode(built);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    expect(keys[0]!.equals(wallet.publicKey)).toBe(true);
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.program).toBe(fixture.programAddress);
    const position = PublicKey.findProgramAddressSync([Buffer.from("position"), new PublicKey(POOL).toBuffer(), wallet.publicKey.toBuffer()], program.programId)[0];
    expect(instructions[0]!.accounts).toEqual([
      wallet.publicKey.toBase58(), "9E52kNuxk7bHHuuvvrG13hvRBinvSnPFNFYM9kcPcKEC", POOL, position.toBase58(), request.toBase58(), VAULT,
      associatedTokenAddress(wallet.publicKey, new PublicKey(MINT)).toBase58(), TOKEN_PROGRAM.toBase58(), SystemProgram.programId.toBase58(),
    ]);
    expect(instructions[0]!.data.subarray(0, 8)).toEqual(discriminator("global", "deposit"));
  });

  it("validates inputs before touching the chain and reports a simulated rejection", async () => {
    const { transactions } = await services();
    const owner = wallet.publicKey.toBase58();
    await expect(transactions.deposit({ owner, toClass: "DOGE", amount: "1", minimumUnits: "0", expiryBatch: 10 })).rejects.toThrow("not a class");
    await expect(transactions.deposit({ owner, toClass: "BTC", amount: "0", minimumUnits: "0", expiryBatch: 10 })).rejects.toThrow("out of range");
    await expect(transactions.deposit({ owner, toClass: "BTC", amount: "1.5", minimumUnits: "0", expiryBatch: 10 })).rejects.toThrow("integer string");
    await expect(transactions.deposit({ owner, toClass: "BTC", amount: "1", minimumUnits: "0", expiryBatch: 5 })).rejects.toThrow("expiryBatch");
    await expect(transactions.switch({ owner, fromClass: "BTC", toClass: "BTC", units: "1", minimumUnits: "0", expiryBatch: 10 })).rejects.toThrow("must differ");
    await expect(transactions.withdraw({ owner: POOL, amount: "1" })).rejects.toThrow("can sign");
    await expect(transactions.cancel({ owner, requestId: REQUEST })).rejects.toThrow("does not belong");
    connection.simulationError = "Insufficient unlocked units";
    await expect(transactions.redeem({ owner, fromClass: "BTC", units: "1", minimumProceeds: "0", expiryBatch: 10 })).rejects.toThrow("Insufficient unlocked units");
  });

  it("builds cancel for the owner's request and creates the payout token account before redeem", async () => {
    const { transactions, program } = await services();
    const cancel = decode(await transactions.cancel({ owner: OWNER, requestId: REQUEST }));
    expect(cancel.instructions[0]!.data.subarray(0, 8)).toEqual(discriminator("global", "cancel"));
    expect(cancel.instructions[0]!.accounts).toContain(REQUEST);
    const redeem = decode(await transactions.redeem({ owner: OWNER, fromClass: "BTC", units: "1000", minimumProceeds: "0", expiryBatch: 6 }));
    expect(redeem.instructions.map((i) => i.program)).toEqual(["ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", fixture.programAddress]);
    expect(redeem.instructions[0]!.data).toEqual(Buffer.from([1]));
  });

  it("relays exactly the signed bytes, refuses unsigned or foreign transactions and tracks the result", async () => {
    const { transactions, submissions } = await services();
    const built = await transactions.withdraw({ owner: wallet.publicKey.toBase58(), amount: "5" });
    const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
    await expect(submissions.submit(built.transaction)).rejects.toThrow("not fully signed");
    tx.sign([wallet]);
    const signed = Buffer.from(tx.serialize()).toString("base64");
    const submission = await submissions.submit(signed);
    expect(connection.sent.map((b) => b.toString("base64"))).toEqual([signed]);
    expect(submission).toMatchObject({ owner: wallet.publicKey.toBase58(), operation: "withdraw", transaction: signed, state: "submitted", submittedAt: NOW });
    connection.status = { slot: 77, confirmationStatus: "finalized", err: null };
    expect(await submissions.get(submission.signature)).toMatchObject({ state: "finalized", slot: 77 });
    expect(await submissions.submit(signed)).toMatchObject({ state: "finalized" });
    expect(connection.sent).toHaveLength(1);
    const reopened = new CoxSubmissions({ connection: connection as unknown as Connection, programId: new PublicKey(fixture.programAddress), path: join(dir, "submissions.json") });
    expect(await reopened.get(submission.signature)).toMatchObject({ state: "finalized", transaction: signed });
    const transfer = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(VAULT), lamports: 1 });
    const foreign = new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: built.recentBlockhash, instructions: [transfer] }).compileToV0Message());
    foreign.sign([wallet]);
    await expect(submissions.submit(Buffer.from(foreign.serialize()).toString("base64"))).rejects.toThrow("outside COX");
  });

  it("serves builders, submission and lookup over HTTP", async () => {
    const { source, transactions, submissions } = await services();
    const server = createCoxApiServer({ source, transactions, submissions, now: () => NOW });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const client = createCoxApiClient({ baseUrl });
    const json = { "content-type": "application/json" };
    try {
      const built = (await client.buildWithdraw({ owner: wallet.publicKey.toBase58(), amount: "5" })).data;
      const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
      tx.sign([wallet]);
      const submitted = (await client.submitTransaction(Buffer.from(tx.serialize()).toString("base64"))).data;
      expect((await client.submission(submitted.signature)).data.signature).toBe(submitted.signature);
      await expect(client.submission("1".repeat(64))).rejects.toMatchObject({ code: "TRANSACTION_NOT_FOUND", httpStatus: 404 });
      await expect(client.buildDeposit({ owner: wallet.publicKey.toBase58(), toClass: "NOPE", amount: "1", minimumUnits: "0", expiryBatch: 10 })).rejects.toMatchObject({ code: "INVALID_REQUEST", httpStatus: 400 });
      connection.simulationError = "Pool paused";
      await expect(client.buildWithdraw({ owner: wallet.publicKey.toBase58(), amount: "5" })).rejects.toMatchObject({ code: "TRANSACTION_REJECTED", httpStatus: 422 });
      expect((await fetch(`${baseUrl}/v1/transactions/withdraw`, { method: "POST", body: "{}" })).status).toBe(415);
      expect((await fetch(`${baseUrl}/v1/transactions/withdraw`, { method: "POST", headers: json, body: JSON.stringify({ pad: "x".repeat(9000) }) })).status).toBe(413);
      expect((await fetch(`${baseUrl}/v1/transactions/publish`, { method: "POST", headers: json, body: "{}" })).status).toBe(404);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
