import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { parseSolanaTransaction, requiredSignerIndex, verifyEd25519 } from "../src/solana.js";

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
