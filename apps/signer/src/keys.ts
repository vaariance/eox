import { createPublicKey } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { publicKeyToAddress } from "viem/accounts";
import type { Chain } from "@eox/signing";

export interface DerivedKey {
  chain: Chain;
  publicKey: string;
  address: string;
  rawPublicKey: Uint8Array;
}

function jwk(pem: string) {
  return createPublicKey(pem).export({ format: "jwk" });
}

export function deriveSolanaKey(pem: string): DerivedKey {
  const key = jwk(pem);
  if (key.kty !== "OKP" || key.crv !== "Ed25519" || !key.x) throw new Error("expected an Ed25519 public key");
  const raw = Buffer.from(key.x, "base64url");
  if (raw.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  const address = new PublicKey(raw).toBase58();
  return { chain: "solana", publicKey: address, address, rawPublicKey: new Uint8Array(raw) };
}

export function deriveEvmKey(pem: string): DerivedKey {
  const key = jwk(pem);
  if (key.kty !== "EC" || key.crv !== "secp256k1" || !key.x || !key.y) throw new Error("expected a secp256k1 public key");
  const x = Buffer.from(key.x, "base64url");
  const y = Buffer.from(key.y, "base64url");
  if (x.length !== 32 || y.length !== 32) throw new Error("secp256k1 coordinates must be 32 bytes");
  const uncompressed = Buffer.concat([Buffer.from([4]), x, y]);
  const publicKey = `0x${uncompressed.toString("hex")}` as const;
  return { chain: "evm", publicKey, address: publicKeyToAddress(publicKey), rawPublicKey: new Uint8Array(uncompressed) };
}
