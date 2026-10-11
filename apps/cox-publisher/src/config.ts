import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { PILOT_ASSETS, DEV_RUNTIME, type AssetId } from "@cox/methodology";

export const COX_PROGRAM_ID = "G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF";
export const DEV_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEV_SIGNER_NETWORK = `solana:${DEV_GENESIS.slice(0, 32)}`;
export const DEV_KEY_VERSION = "projects/colosseum-eox/locations/us-central1/keyRings/eox-signing-dev/cryptoKeys/oracle-operator/cryptoKeyVersions/1";
export const DEV_SIGNER_URL = "https://signer.getrelative.trade";

export interface PublisherConfig {
  enabled: boolean;
  rpcUrl: string;
  archiveUrl: string;
  signerUrl: string;
  signerAudience: string;
  statePath: string;
  poolId: string | null;
  methodologyDigest: string | null;
  assets: AssetId[];
  origin: string | null;
  bybit: boolean;
  runtimeAuthority: string;
  genesisHash: string;
  signerNetwork: string;
  keyVersion: string;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: number;
  pollMs: number;
  retryMaxMs: number;
}
export type ReadyConfig = PublisherConfig & { enabled: true; poolId: string; methodologyDigest: string; origin: string };

export function assertReady(config: PublisherConfig): asserts config is ReadyConfig {
  if (!config.enabled || config.poolId === null || config.methodologyDigest === null || config.origin === null) throw new Error("PublisherNotConfigured");
}

export async function loadConfig(path: string): Promise<PublisherConfig> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("InvalidPublisherConfig");
  const input = value as Record<string, unknown>;
  const fields = ["enabled", "rpcUrl", "archiveUrl", "signerUrl", "signerAudience", "statePath", "poolId", "methodologyDigest", "assets", "origin", "bybit", "runtimeAuthority", "genesisHash", "signerNetwork", "keyVersion", "computeUnitLimit", "computeUnitPriceMicroLamports", "pollMs", "retryMaxMs"];
  if (Object.keys(input).length !== fields.length || fields.some(field => !(field in input))) throw new Error("InvalidPublisherConfigFields");
  const valid = (condition: boolean, field: string) => { if (!condition) throw new Error(`InvalidPublisherConfig:${field}`); };
  valid(typeof input.enabled === "boolean", "enabled");
  valid(typeof input.bybit === "boolean", "bybit");
  for (const field of ["rpcUrl", "archiveUrl", "signerUrl", "signerAudience"]) {
    valid(typeof input[field] === "string", field);
    const url = new URL(input[field] as string);
    valid(["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.hash && !url.search, field);
    valid(url.protocol === "https:" || ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), field);
  }
  valid(typeof input.statePath === "string" && isAbsolute(input.statePath) && !input.statePath.endsWith("/"), "statePath");
  const integer = (field: string, minimum: number, maximum: number) => valid(typeof input[field] === "number" && Number.isSafeInteger(input[field]) && (input[field] as number) >= minimum && (input[field] as number) <= maximum, field);
  integer("computeUnitLimit", 1, 1_400_000);
  integer("computeUnitPriceMicroLamports", 0, 1_000);
  integer("pollMs", 100, 30_000);
  integer("retryMaxMs", 100, 30_000);
  for (const field of ["poolId", "origin"]) {
    const number = input[field];
    valid(number === null || (typeof number === "string" && /^(0|[1-9][0-9]{0,19})$/.test(number) && BigInt(number) <= (1n << 64n) - 1n), field);
  }
  valid(input.origin === null || (BigInt(input.origin as string) > 0n && BigInt(input.origin as string) % 60n === 0n), "origin");
  valid(input.methodologyDigest === null || (typeof input.methodologyDigest === "string" && /^[a-f0-9]{64}$/.test(input.methodologyDigest) && input.methodologyDigest !== "0".repeat(64)), "methodologyDigest");
  valid(Array.isArray(input.assets), "assets");
  const assets = input.assets as unknown[];
  const canonical = PILOT_ASSETS.filter(asset => assets.includes(asset.id)).map(asset => asset.id);
  valid(assets.length >= 2 && assets.length <= 30 && canonical.length === assets.length && canonical.every((asset, index) => assets[index] === asset), "assets");
  valid(input.runtimeAuthority === DEV_RUNTIME, "runtimeAuthority");
  valid(input.genesisHash === DEV_GENESIS, "genesisHash");
  valid(input.signerNetwork === DEV_SIGNER_NETWORK, "signerNetwork");
  valid(input.keyVersion === DEV_KEY_VERSION, "keyVersion");
  valid(input.signerUrl === (process.env.COX_SIGNER_URL ?? DEV_SIGNER_URL), "signerUrl");
  valid(input.signerAudience === (process.env.COX_SIGNER_AUDIENCE ?? DEV_SIGNER_URL), "signerAudience");
  const config = input as unknown as PublisherConfig;
  if (config.enabled) assertReady(config);
  return config;
}
