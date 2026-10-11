import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import anchor, { type Idl } from "@coral-xyz/anchor";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { addresses, checkedPublication, decodeAccount, stateBytes, stateDigest, type Publication } from "@cox/client";
import { PublicationHistory } from "../src/history.ts";

const idl = JSON.parse(readFileSync(new URL("../../../packages/cox/idl/cox.json", import.meta.url), "utf8")) as Idl;
const fixtures = JSON.parse(readFileSync(new URL("../../../packages/cox/fixtures/accounts.json", import.meta.url), "utf8")) as {
  accounts: { name: string; address: string; owner: string; dataHex: string }[];
};
const program = new anchor.Program(idl, { connection: {} as never });
const observed = (data: Buffer): AccountInfo<Buffer> => ({ data, owner: program.programId, executable: false, lamports: 42265600, rentEpoch: 0 });
const source = fixtures.accounts.find(value => value.name === "publication")!;
const original = decodeAccount(program, "publication", observed(Buffer.from(source.dataHex, "hex")));
const originalState = checkedPublication(program.programId, original.pool, original).state;
const poolFixture = fixtures.accounts.find(value => value.name === "pool")!;
const pool = decodeAccount(program, "pool", observed(Buffer.from(poolFixture.dataHex, "hex")));
const poolId = BigInt(pool.poolId.toString());
const identity = { program: program.programId.toBase58(), pool: original.pool.toBase58(), genesisHash: "test-genesis" };
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function publication(sequence: bigint, previousState: Uint8Array = Buffer.alloc(32), extra = 0): AccountInfo<Buffer> {
  const state = { ...originalState, sequence, batch: sequence, previousState, cutoff: originalState.cutoff + sequence * 60n,
    residual: originalState.residual + BigInt(extra) };
  const value: Publication = { ...original, sequence: new anchor.BN(sequence.toString()), batch: new anchor.BN(sequence.toString()),
    statePreimage: [...stateBytes(state)], stateDigest: [...stateDigest(state)] };
  const coder = program.coder.accounts as unknown as { accountLayouts: Map<string, { layout: { encode(value: unknown, bytes: Buffer): number }; discriminator: number[] }> };
  const layout = coder.accountLayouts.get("publication")!;
  const encoded = Buffer.alloc(8192);
  Buffer.from(layout.discriminator).copy(encoded);
  layout.layout.encode({ ...value, statePreimage: Buffer.from(value.statePreimage) }, encoded.subarray(8));
  return observed(encoded);
}
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "cox-history-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, history: new PublicationHistory(directory, program, identity, poolId) };
}

test("archives complete consecutive finalized accounts, preserving original slot on retry", async t => {
  const { directory, history } = await setup(t);
  const zero = publication(0n);
  await history.preserve(zero, 100);
  const firstBytes = await readFile(join(directory, "0.json"));
  await history.preserve(zero, 200);
  assert.deepEqual(await readFile(join(directory, "0.json")), firstBytes);
  const savedZero = await history.read(0n);
  assert.equal(savedZero.record.finalizedSlot, 100);
  assert.equal(savedZero.record.accountBase64, zero.data.toString("base64"));
  assert.equal(savedZero.record.accountSha256, digest(zero.data));
  const one = publication(1n, Buffer.from(savedZero.value.stateDigest));
  await history.preserve(one, 201);
  const savedOne = await history.read(1n);
  assert.equal(savedOne.record.accountBase64, one.data.toString("base64"));
  assert.equal(savedOne.value.state.sequence, 1n);
  assert.equal(savedOne.record.address, addresses(program.programId).publication(original.pool).toBase58());
  assert.deepEqual((await readdir(directory)).sort(), ["0.json", "1.json"]);
});

test("archive refuses missing predecessor, broken chain and conflicting account bytes", async t => {
  const { history } = await setup(t);
  await assert.rejects(history.preserve(publication(1n), 1), /PublicationHistoryGap:0/);
  await history.preserve(publication(0n), 2);
  await assert.rejects(history.preserve(publication(1n, Buffer.alloc(32, 5)), 3), /PublicationHistoryChainMismatch/);
  await assert.rejects(history.preserve(publication(0n, Buffer.alloc(32), 1), 4), /PublicationHistoryConflict/);
  await assert.rejects(history.preserve(publication(0n, Buffer.alloc(32, 1)), 5), /PublicationHistoryOriginMismatch/);
});

test("archive reads verify account bytes, metadata, identity and requested sequence", async t => {
  const { directory, history } = await setup(t);
  await history.preserve(publication(0n), 100);
  const path = join(directory, "0.json");
  const pristine = JSON.parse(await readFile(path, "utf8"));
  const badAccount = Buffer.from(pristine.accountBase64, "base64"); badAccount[100] ^= 1;
  for (const bad of [
    { ...pristine, accountBase64: badAccount.toString("base64") },
    { ...pristine, stateDigest: "00".repeat(32) },
    { ...pristine, sequence: "1" },
    { ...pristine, finalizedSlot: -1 },
    { ...pristine, identity: { ...identity, genesisHash: "other" } },
    { ...pristine, address: PublicKey.default.toBase58() },
  ]) {
    await writeFile(path, JSON.stringify(bad));
    await assert.rejects(history.read(0n));
  }
  await writeFile(path, JSON.stringify(pristine));
  await writeFile(join(directory, "1.json"), JSON.stringify(pristine));
  await assert.rejects(history.read(1n), /PublicationHistorySequenceMismatch/);
  await assert.rejects(history.read(-1n), /InvalidHistorySequence/);
  await assert.rejects(history.read(1n << 64n), /InvalidHistorySequence/);
});

test("invalid observation and failed disk write never produce an accepted archive record", async t => {
  const { directory, history } = await setup(t);
  const zero = publication(0n);
  await assert.rejects(history.preserve({ ...zero, owner: PublicKey.default }, 1), /AccountOwnerMismatch/);
  await assert.rejects(history.preserve({ ...zero, data: zero.data.subarray(0, 8191) }, 1), /InvalidPublicationObservation/);
  await assert.rejects(history.preserve(zero, Number.NaN), /InvalidPublicationObservation/);
  const blocked = join(directory, "file"); await writeFile(blocked, "blocks directory");
  const failing = new PublicationHistory(join(blocked, "history"), program, identity, poolId);
  await assert.rejects(failing.preserve(zero, 1), /ENOTDIR/);
  assert.deepEqual(await readdir(directory), ["file"]);
});

test("orphan temporary files do not prevent recovery or replace immutable records", async t => {
  const { directory, history } = await setup(t);
  await writeFile(join(directory, ".interrupted.tmp"), "partial interrupted write");
  await history.preserve(publication(0n), 10);
  const restarted = new PublicationHistory(directory, program, identity, poolId);
  await restarted.preserve(publication(0n), 11);
  const zero = await restarted.read(0n);
  await restarted.preserve(publication(1n, Buffer.from(zero.value.stateDigest)), 12);
  assert.equal((await restarted.read(1n)).value.sequence.toString(), "1");
  assert.equal(await readFile(join(directory, ".interrupted.tmp"), "utf8"), "partial interrupted write");
});

test("archive constructor rejects a mislabeled pool identity", () => {
  assert.throws(() => new PublicationHistory("unused", program, { ...identity, pool: PublicKey.default.toBase58() }, poolId), /HistoryIdentityMismatch/);
});
