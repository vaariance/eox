import { readFileSync } from "node:fs";
import { SIGNING_ROLES, type Environment, type KeyDirectoryEntry, type SigningRole } from "@eox/signing";
import { assertKeyVersion } from "./kms.js";

export interface SolanaInstructionRule {
  discriminator: string;
  accounts: Record<string, string>;
}

export interface CoxLinkage {
  kind: "cox-v1";
  poolId: string;
  pool: string;
  methodology: string | null;
}

export interface SolanaProgramBinding {
  programId: string;
  enabled?: boolean;
  discriminators: string[];
  instructions?: SolanaInstructionRule[];
  linkage?: CoxLinkage;
}

export const SIGNER_ACCOUNT = "$signer";

export interface RoleBindings {
  solana?: { maxComputeUnitPriceMicroLamports: string; maxComputeUnitLimit?: string; programs: SolanaProgramBinding[] };
}

export interface RoleKey {
  keyVersion: string;
  network: string;
  validFrom: number;
}

export interface SignerConfig {
  environment: Environment;
  audience: string;
  keys: Record<SigningRole, RoleKey>;
  callers: Record<string, SigningRole[]>;
  bindings: Partial<Record<SigningRole, RoleBindings>>;
  directoryVersion: number;
  retired: KeyDirectoryEntry[];
}

const EMAIL_PATTERN = /^[a-z0-9-]{6,30}@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX_PATTERN = /^[0-9a-f]{2,64}$/;
const INTEGER_PATTERN = /^(0|[1-9][0-9]{0,30})$/;

function fail(message: string): never {
  throw new Error(`invalid signer config: ${message}`);
}

export function loadSignerConfig(path: string): SignerConfig {
  const config = JSON.parse(readFileSync(path, "utf8")) as SignerConfig;
  if (!["dev", "testnet", "mainnet"].includes(config.environment)) fail("environment");
  if (typeof config.audience !== "string") fail("audience");
  for (const role of SIGNING_ROLES) {
    const key = config.keys?.[role];
    if (!key) fail(`missing key for ${role}`);
    assertKeyVersion(key.keyVersion);
    if (!key.network.startsWith("solana:")) fail(`${role} network ${key.network} is not a Solana network`);
  }
  if (!Number.isSafeInteger(config.directoryVersion) || config.directoryVersion < 1) fail("directoryVersion");
  for (const entry of config.retired ?? []) {
    if ((SIGNING_ROLES as readonly string[]).includes(entry.role)) fail(`retired entry ${entry.role} is still a signing role`);
    if (entry.state !== "retired" || !Number.isSafeInteger(entry.validUntil) || entry.validUntil! < entry.validFrom) fail(`retired entry ${entry.role}`);
    assertKeyVersion(entry.keyVersion);
    if (entry.environment !== config.environment) fail(`retired entry ${entry.role} environment`);
  }
  for (const [email, roles] of Object.entries(config.callers ?? {})) {
    if (!EMAIL_PATTERN.test(email)) fail(`caller ${email} is not a service account`);
    for (const role of roles) if (!SIGNING_ROLES.includes(role)) fail(`caller ${email} has unknown role ${role}`);
  }
  for (const [role, bindings] of Object.entries(config.bindings ?? {})) {
    if (!SIGNING_ROLES.includes(role as SigningRole)) fail(`bindings for unknown role ${role}`);
    if (Object.keys(bindings ?? {}).some((k) => k !== "solana")) fail(`${role} may bind only Solana programs`);
    if (bindings?.solana) {
      if (!INTEGER_PATTERN.test(bindings.solana.maxComputeUnitPriceMicroLamports)) fail(`${role} compute price limit`);
      const unitLimit = bindings.solana.maxComputeUnitLimit;
      if (unitLimit !== undefined && (!INTEGER_PATTERN.test(unitLimit) || Number(unitLimit) > 1_400_000)) fail(`${role} compute unit limit`);
      for (const program of bindings.solana.programs) {
        if (!BASE58_PATTERN.test(program.programId)) fail(`${role} program ${program.programId}`);
        if (program.enabled !== undefined && typeof program.enabled !== "boolean") fail(`${role} program enabled flag`);
        if (program.linkage) {
          const l = program.linkage;
          if (l.kind !== "cox-v1" || !INTEGER_PATTERN.test(l.poolId) || !BASE58_PATTERN.test(l.pool)) fail(`${role} COX linkage`);
          if (l.methodology !== null && !BASE58_PATTERN.test(l.methodology)) fail(`${role} COX methodology`);
        }
        for (const discriminator of program.discriminators) if (!HEX_PATTERN.test(discriminator)) fail(`${role} discriminator`);
        if (program.instructions) {
          for (const discriminator of program.discriminators) {
            if (!program.instructions.some((rule) => rule.discriminator === discriminator)) fail(`${role} discriminator ${discriminator} has no account rule`);
          }
          for (const rule of program.instructions) {
            if (!program.discriminators.includes(rule.discriminator)) fail(`${role} account rule for unlisted discriminator ${rule.discriminator}`);
            for (const [index, account] of Object.entries(rule.accounts)) {
              if (!/^(0|[1-9][0-9]?)$/.test(index)) fail(`${role} account index ${index}`);
              if (account !== SIGNER_ACCOUNT && !BASE58_PATTERN.test(account)) fail(`${role} account ${account}`);
            }
          }
        }
      }
    }
  }
  return config;
}
