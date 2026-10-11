import { createPublicKey } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export interface DerivedKey {
  chain: "solana";
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
