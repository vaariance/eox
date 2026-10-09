import {
  keccak256,
  parseTransaction,
  recoverAddress,
  serializeTransaction,
  toHex,
  type Hex,
  type TransactionSerializable,
} from "viem";
import { signDigest, type AccessToken } from "./kms.js";

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = SECP256K1_N / 2n;

export interface EvmSignature {
  r: Hex;
  s: Hex;
  yParity: 0 | 1;
}

function readDerInteger(der: Uint8Array, offset: number): { value: bigint; next: number } {
  if (der[offset] !== 0x02) throw new Error("invalid DER signature: expected integer");
  const length = der[offset + 1]!;
  if (length < 1 || length > 33) throw new Error("invalid DER signature: integer length");
  const bytes = der.subarray(offset + 2, offset + 2 + length);
  return { value: BigInt(`0x${Buffer.from(bytes).toString("hex")}`), next: offset + 2 + length };
}

export function decodeDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error("invalid DER signature: sequence");
  const r = readDerInteger(der, 2);
  const s = readDerInteger(der, r.next);
  if (s.next !== der.length) throw new Error("invalid DER signature: trailing bytes");
  if (r.value <= 0n || r.value >= SECP256K1_N || s.value <= 0n || s.value >= SECP256K1_N) {
    throw new Error("invalid DER signature: out of range");
  }
  return { r: r.value, s: s.value };
}

export async function recoverableSignature(digest: Hex, der: Uint8Array, expectedAddress: string): Promise<EvmSignature> {
  const decoded = decodeDerSignature(der);
  const s = decoded.s > HALF_N ? SECP256K1_N - decoded.s : decoded.s;
  const r = toHex(decoded.r, { size: 32 });
  const sHex = toHex(s, { size: 32 });
  for (const yParity of [0, 1] as const) {
    const recovered = await recoverAddress({ hash: digest, signature: { r, s: sHex, yParity } });
    if (recovered.toLowerCase() === expectedAddress.toLowerCase()) return { r, s: sHex, yParity };
  }
  throw new Error("KMS signature does not recover to the expected address");
}

export function parseUnsignedTransaction(unsignedTransactionHex: Hex): TransactionSerializable {
  const transaction = parseTransaction(unsignedTransactionHex) as TransactionSerializable & { r?: Hex; s?: Hex };
  if (transaction.r !== undefined || transaction.s !== undefined) throw new Error("transaction is already signed");
  if (transaction.chainId === undefined) throw new Error("transaction must specify a chain id");
  if (serializeTransaction(transaction) !== unsignedTransactionHex) {
    throw new Error("transaction bytes are not in canonical unsigned form");
  }
  return transaction;
}

export async function signEvmTransaction(
  token: AccessToken,
  keyVersion: string,
  address: string,
  unsignedTransactionHex: Hex,
): Promise<{ signature: EvmSignature; signedTransaction: Hex; digest: Hex }> {
  const transaction = parseUnsignedTransaction(unsignedTransactionHex);
  const digest = keccak256(unsignedTransactionHex);
  const der = await signDigest(token, keyVersion, Buffer.from(digest.slice(2), "hex"));
  const signature = await recoverableSignature(digest, der, address);
  return { signature, signedTransaction: serializeTransaction(transaction, signature), digest };
}
