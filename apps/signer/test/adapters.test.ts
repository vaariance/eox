import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { keccak256, serializeTransaction, type Hex } from "viem";
import { privateKeyToAccount, sign as signHash } from "viem/accounts";
import { decodeDerSignature, parseUnsignedTransaction, recoverableSignature } from "../src/evm.js";
import { parseSolanaTransaction, requiredSignerIndex, verifyEd25519 } from "../src/solana.js";

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const privateKey = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318" as const;
const account = privateKeyToAccount(privateKey);

function derInteger(value: bigint): Buffer {
  let bytes = Buffer.from(value.toString(16).padStart(64, "0"), "hex");
  while (bytes.length > 1 && bytes[0] === 0 && bytes[1]! < 0x80) bytes = bytes.subarray(1);
  if (bytes[0]! >= 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
}

function der(r: bigint, s: bigint): Uint8Array {
  const body = Buffer.concat([derInteger(r), derInteger(s)]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body]));
}

const unsigned = serializeTransaction({
  type: "eip1559",
  chainId: 11155111,
  nonce: 3,
  to: account.address,
  value: 0n,
  gas: 21_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
});

test("normalizes a high-s DER signature and recovers the signer", async () => {
  const digest = keccak256(unsigned);
  const signature = await signHash({ hash: digest, privateKey });
  const r = BigInt(signature.r);
  const lowS = BigInt(signature.s);
  for (const s of [lowS, N - lowS]) {
    const recovered = await recoverableSignature(digest, der(r, s), account.address);
    assert.equal(BigInt(recovered.s), lowS);
    assert.equal(recovered.yParity, signature.yParity);
  }
});

test("rejects a signature from a different key", async () => {
  const digest = keccak256(unsigned);
  const other = await signHash({ hash: digest, privateKey: "0x8da4ef21b864d2cc526dbdb2a120bd2874c36c9d0a1fb7f8c63d7f7a8b41de8f" });
  await assert.rejects(recoverableSignature(digest, der(BigInt(other.r), BigInt(other.s)), account.address), /does not recover/);
});

test("rejects malformed DER", () => {
  assert.throws(() => decodeDerSignature(new Uint8Array([0x30, 0x02, 0x02, 0x00])), /invalid DER/);
  assert.throws(() => decodeDerSignature(der(0n, 1n)), /out of range/);
  assert.throws(() => decodeDerSignature(new Uint8Array([...der(1n, 1n), 0])), /invalid DER/);
});

test("accepts only canonical unsigned EVM transactions with a chain id", async () => {
  assert.equal(parseUnsignedTransaction(unsigned).chainId, 11155111);
  const signature = await signHash({ hash: keccak256(unsigned), privateKey });
  const signed = serializeTransaction(parseUnsignedTransaction(unsigned), signature);
  assert.throws(() => parseUnsignedTransaction(signed), /already signed/);
  const legacy = serializeTransaction({ type: "legacy", nonce: 1, to: account.address, value: 0n, gas: 21_000n, gasPrice: 1n });
  assert.throws(() => parseUnsignedTransaction(legacy as Hex), /chain id/);
});

function solanaTransaction(payer: PublicKey): string {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 })],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

test("identifies required Solana signers and rejects others", () => {
  const payer = Keypair.generate().publicKey;
  const transaction = parseSolanaTransaction(solanaTransaction(payer));
  assert.equal(requiredSignerIndex(transaction, payer), 0);
  assert.throws(() => requiredSignerIndex(transaction, Keypair.generate().publicKey), /not a required signer/);
});

test("rejects non-canonical Solana transaction encodings", () => {
  const encoded = solanaTransaction(Keypair.generate().publicKey);
  assert.throws(() => parseSolanaTransaction(`${encoded}\n`), /not canonical base64/);
  assert.throws(() => parseSolanaTransaction(Buffer.concat([Buffer.from(encoded, "base64"), Buffer.from([0])]).toString("base64")), /not canonical/);
});

test("verifies Ed25519 signatures against the raw public key", () => {
  const { publicKey, privateKey: secret } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const message = new TextEncoder().encode("eox message");
  const signature = sign(null, message, secret);
  assert.equal(verifyEd25519(raw, message, signature), true);
  assert.equal(verifyEd25519(raw, new TextEncoder().encode("other"), signature), false);
});
