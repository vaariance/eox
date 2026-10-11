import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { CoxLinkage, SolanaProgramBinding } from "../src/config.js";
import { checkCoxLinkage, type ChainAccount } from "../src/cox-linkage.js";
import { PolicyRejection } from "../src/policy.js";

const program = new PublicKey("G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF");
const operator = Keypair.generate().publicKey;
const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program)[0];
const disc = (prefix: string, name: string) => createHash("sha256").update(`${prefix}:${name}`).digest().subarray(0, 8);
const pool = pda(Buffer.from("pool"), u64(0n));
const otherPool = pda(Buffer.from("pool"), u64(1n));
const registry = pda(Buffer.from("registry"));
const vault = pda(Buffer.from("vault"), pool.toBuffer());
const methodology = Keypair.generate().publicKey;
const header = (name: string) => Buffer.concat([disc("account", name), Buffer.from([1, 0, 255])]);
const requestData = (forPool: PublicKey, owner: PublicKey, nonce: bigint) => Buffer.concat([header("Request"), forPool.toBuffer(), owner.toBuffer(), u64(nonce)]);

const owner = Keypair.generate().publicKey;
const batch = pda(Buffer.from("batch"), pool.toBuffer());
const request = pda(Buffer.from("request"), pool.toBuffer(), u64(3n));
const position = pda(Buffer.from("position"), pool.toBuffer(), owner.toBuffer());
const publication = pda(Buffer.from("publication"), pool.toBuffer());
const chain = new Map<string, ChainAccount>([
  [request.toBase58(), { owner: program, data: requestData(pool, owner, 3n) }],
]);
const fetch = async (keys: PublicKey[]) => keys.map((k) => chain.get(k.toBase58()) ?? null);

const binding: SolanaProgramBinding = { programId: program.toBase58(), discriminators: [] };
const linkage = (bound: PublicKey | null = methodology): CoxLinkage => ({ kind: "cox-v2", poolId: "0", pool: pool.toBase58(), methodology: bound?.toBase58() ?? null });

function tx(name: string, keys: PublicKey[], args = Buffer.alloc(0)) {
  const instruction = new TransactionInstruction({ programId: program, keys: keys.map((pubkey) => ({ pubkey, isSigner: pubkey.equals(operator), isWritable: true })), data: Buffer.concat([disc("global", name), args]) });
  return new VersionedTransaction(new TransactionMessage({ payerKey: operator, recentBlockhash: "11111111111111111111111111111111", instructions: [instruction] }).compileToV0Message());
}

async function refused(promise: Promise<void>, pattern: RegExp) {
  await assert.rejects(promise, (e) => e instanceof PolicyRejection && e.code === "TARGET_NOT_BOUND" && pattern.test(e.message));
}

test("a crank passes only with the pool's batch account, request and the request owner's position", async () => {
  await checkCoxLinkage(binding, linkage(), tx("execute", [registry, pool, batch, request, position, vault]), fetch);
  await refused(checkCoxLinkage(binding, linkage(), tx("execute", [registry, pool, batch, request, pda(Buffer.from("position"), pool.toBuffer(), Keypair.generate().publicKey.toBuffer()), vault]), fetch), /request owner's position/);
  const foreign = pda(Buffer.from("request"), otherPool.toBuffer(), u64(3n));
  chain.set(foreign.toBase58(), { owner: program, data: requestData(otherPool, owner, 3n) });
  await refused(checkCoxLinkage(binding, linkage(), tx("evaluate", [registry, pool, batch, foreign, position, vault]), fetch), /another pool/);
  await refused(checkCoxLinkage(binding, linkage(), tx("safety", [registry, pool, pda(Buffer.from("batch"), pool.toBuffer(), u64(7n)), request, position, vault]), fetch), /not the pool's batch account/);
  await refused(checkCoxLinkage(binding, linkage(), tx("seal_evaluation", [registry, pool, pda(Buffer.from("batch"), otherPool.toBuffer()), vault]), fetch), /not the pool's batch account/);
  await checkCoxLinkage(binding, linkage(), tx("seal_evaluation", [registry, pool, batch, vault]), fetch);
});

test("publish needs the bound methodology and the pool's batch account, which may not exist yet", async () => {
  const publish = (methodologyAccount: PublicKey, batchAccount: PublicKey) =>
    tx("publish", [operator, operator, registry, pool, methodologyAccount, batchAccount, vault, SystemProgram.programId], u64(7n));
  await checkCoxLinkage(binding, linkage(), publish(methodology, batch), fetch);
  await refused(checkCoxLinkage(binding, linkage(null), publish(methodology, batch), fetch), /no sealed methodology/);
  await refused(checkCoxLinkage(binding, linkage(), publish(Keypair.generate().publicKey, batch), fetch), /not the bound methodology/);
  await refused(checkCoxLinkage(binding, linkage(), publish(methodology, pda(Buffer.from("batch"), pool.toBuffer(), u64(7n))), fetch), /not the pool's batch account/);
});

test("finalize needs the pool's batch and publication accounts, which may not exist yet", async () => {
  const finalize = (publicationAccount: PublicKey) => tx("finalize", [operator, registry, pool, batch, methodology, publicationAccount, vault, SystemProgram.programId]);
  await checkCoxLinkage(binding, linkage(), finalize(publication), fetch);
  await refused(checkCoxLinkage(binding, linkage(), finalize(pda(Buffer.from("publication"), pool.toBuffer(), u64(5n))), fetch), /pool's publication account/);
});

test("a linkage naming another pool than its id is refused", async () => {
  await refused(checkCoxLinkage(binding, { ...linkage(), pool: otherPool.toBase58() }, tx("seal_evaluation", [registry, pool, batch, vault]), fetch), /is not pool 0/);
});

test("accepts the fee upgrade's compiled schema 2 request and refuses unknown request schemas", async () => {
  const fixtures = JSON.parse(readFileSync(new URL("../../../packages/cox/fixtures/fee-accounts.json", import.meta.url), "utf8")) as { accounts: { name: string; address: string; dataHex: string }[] };
  const compiled = fixtures.accounts.find((a) => a.name === "request")!;
  const data = Buffer.from(compiled.dataHex, "hex");
  assert.equal(data.readUInt16LE(8), 2);
  const address = new PublicKey(compiled.address);
  const holder = new PublicKey(data.subarray(43, 75));
  const holderPosition = pda(Buffer.from("position"), pool.toBuffer(), holder.toBuffer());
  chain.set(address.toBase58(), { owner: program, data });
  await checkCoxLinkage(binding, linkage(), tx("execute", [registry, pool, batch, address, holderPosition, vault]), fetch);
  const future = Buffer.from(data);
  future.writeUInt16LE(3, 8);
  chain.set(address.toBase58(), { owner: program, data: future });
  await refused(checkCoxLinkage(binding, linkage(), tx("execute", [registry, pool, batch, address, holderPosition, vault]), fetch), /unsupported schema 3/);
  chain.set(address.toBase58(), { owner: program, data: data.subarray(0, 60) });
  await refused(checkCoxLinkage(binding, linkage(), tx("execute", [registry, pool, batch, address, holderPosition, vault]), fetch), /not a request account/);
});
