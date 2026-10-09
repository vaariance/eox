import { createPublicKey, verify } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { signData, type AccessToken } from "./kms.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyEd25519(rawPublicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]), format: "der", type: "spki" });
  return verify(null, message, key, signature);
}

export function parseSolanaTransaction(transactionBase64: string): VersionedTransaction {
  const bytes = Buffer.from(transactionBase64, "base64");
  if (bytes.toString("base64") !== transactionBase64) throw new Error("transaction is not canonical base64");
  const transaction = VersionedTransaction.deserialize(bytes);
  if (Buffer.from(transaction.serialize()).toString("base64") !== transactionBase64) {
    throw new Error("transaction bytes are not canonical");
  }
  return transaction;
}

export function requiredSignerIndex(transaction: VersionedTransaction, signer: PublicKey): number {
  const required = transaction.message.header.numRequiredSignatures;
  const index = transaction.message.staticAccountKeys.slice(0, required).findIndex((key) => key.equals(signer));
  if (index === -1) throw new Error(`${signer.toBase58()} is not a required signer of this transaction`);
  return index;
}

export async function signSolanaTransaction(
  token: AccessToken,
  keyVersion: string,
  rawPublicKey: Uint8Array,
  transactionBase64: string,
): Promise<{ signature: Uint8Array; signedTransaction: string; message: Uint8Array }> {
  const transaction = parseSolanaTransaction(transactionBase64);
  const signer = new PublicKey(rawPublicKey);
  requiredSignerIndex(transaction, signer);
  const message = transaction.message.serialize();
  const signature = await signData(token, keyVersion, message);
  if (signature.length !== 64 || !verifyEd25519(rawPublicKey, message, signature)) {
    throw new Error("KMS signature does not verify against the expected Solana key");
  }
  transaction.addSignature(signer, signature);
  return { signature, signedTransaction: Buffer.from(transaction.serialize()).toString("base64"), message };
}
