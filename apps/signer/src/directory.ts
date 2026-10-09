import {
  CHAIN_ALGORITHMS,
  ROLE_CHAINS,
  SIGNING_ROLES,
  SIGNING_SCHEMA_VERSION,
  type KeyDirectory,
  type KeyDirectoryEntry,
  type SigningRole,
} from "@eox/signing";
import type { SignerConfig } from "./config.js";
import { deriveEvmKey, deriveSolanaKey, type DerivedKey } from "./keys.js";
import { getPublicKey, type AccessToken } from "./kms.js";

const EXPECTED_ALGORITHMS = { solana: "EC_SIGN_ED25519", evm: "EC_SIGN_SECP256K1_SHA256" } as const;

export interface ResolvedKey {
  entry: KeyDirectoryEntry;
  derived: DerivedKey;
}

export async function resolveKeys(config: SignerConfig, token: AccessToken): Promise<Map<SigningRole, ResolvedKey>> {
  const resolved = new Map<SigningRole, ResolvedKey>();
  for (const role of SIGNING_ROLES) {
    const key = config.keys[role];
    const chain = ROLE_CHAINS[role];
    const kms = await getPublicKey(token, key.keyVersion);
    if (kms.algorithm !== EXPECTED_ALGORITHMS[chain]) {
      throw new Error(`${role} key uses ${kms.algorithm}, expected ${EXPECTED_ALGORITHMS[chain]}`);
    }
    const derived = chain === "solana" ? deriveSolanaKey(kms.pem) : deriveEvmKey(kms.pem);
    resolved.set(role, {
      derived,
      entry: {
        role,
        environment: config.environment,
        chain,
        network: key.network,
        algorithm: CHAIN_ALGORITHMS[chain],
        publicKey: derived.publicKey,
        address: derived.address,
        keyVersion: key.keyVersion,
        state: "active",
        validFrom: key.validFrom,
        validUntil: null,
      },
    });
  }
  return resolved;
}

export function keyDirectory(config: SignerConfig, keys: Map<SigningRole, ResolvedKey>, version: number, generatedAt: number): KeyDirectory {
  return {
    schemaVersion: SIGNING_SCHEMA_VERSION,
    environment: config.environment,
    version,
    generatedAt,
    entries: SIGNING_ROLES.map((role) => keys.get(role)!.entry),
  };
}
