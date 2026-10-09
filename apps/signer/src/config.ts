import { readFileSync } from "node:fs";
import { ROLE_CHAINS, SIGNING_ROLES, type Environment, type SigningRole } from "@eox/signing";
import { assertKeyVersion } from "./kms.js";

export interface EvmContractBinding {
  address: string;
  selectors: string[];
  maxValueWei: string;
}

export interface SolanaProgramBinding {
  programId: string;
  discriminators: string[];
}

export interface RoleBindings {
  evm?: { maxFeePerGasWei: string; maxGas: string; contracts: EvmContractBinding[] };
  solana?: { maxComputeUnitPriceMicroLamports: string; programs: SolanaProgramBinding[] };
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
}

const EMAIL_PATTERN = /^[a-z0-9-]{6,30}@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const SELECTOR_PATTERN = /^0x[0-9a-f]{8}$/;
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
    const prefix = ROLE_CHAINS[role] === "evm" ? "eip155:" : "solana:";
    if (!key.network.startsWith(prefix)) fail(`${role} network ${key.network} does not match its chain`);
  }
  for (const [email, roles] of Object.entries(config.callers ?? {})) {
    if (!EMAIL_PATTERN.test(email)) fail(`caller ${email} is not a service account`);
    for (const role of roles) if (!SIGNING_ROLES.includes(role)) fail(`caller ${email} has unknown role ${role}`);
  }
  for (const [role, bindings] of Object.entries(config.bindings ?? {})) {
    if (!SIGNING_ROLES.includes(role as SigningRole)) fail(`bindings for unknown role ${role}`);
    const chain = ROLE_CHAINS[role as SigningRole];
    if (chain === "evm" && bindings?.solana) fail(`${role} cannot bind Solana programs`);
    if (chain === "solana" && bindings?.evm) fail(`${role} cannot bind EVM contracts`);
    if (bindings?.evm) {
      if (!INTEGER_PATTERN.test(bindings.evm.maxFeePerGasWei) || !INTEGER_PATTERN.test(bindings.evm.maxGas)) fail(`${role} EVM limits`);
      for (const contract of bindings.evm.contracts) {
        if (!EVM_ADDRESS_PATTERN.test(contract.address)) fail(`${role} contract address ${contract.address}`);
        if (!INTEGER_PATTERN.test(contract.maxValueWei)) fail(`${role} max value`);
        for (const selector of contract.selectors) if (!SELECTOR_PATTERN.test(selector)) fail(`${role} selector ${selector}`);
      }
    }
    if (bindings?.solana) {
      if (!INTEGER_PATTERN.test(bindings.solana.maxComputeUnitPriceMicroLamports)) fail(`${role} compute price limit`);
      for (const program of bindings.solana.programs) {
        if (!BASE58_PATTERN.test(program.programId)) fail(`${role} program ${program.programId}`);
        for (const discriminator of program.discriminators) if (!HEX_PATTERN.test(discriminator)) fail(`${role} discriminator`);
      }
    }
  }
  return config;
}
