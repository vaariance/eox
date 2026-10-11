import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { loadSignerConfig } from "../src/config.js";
import { crc32c } from "../src/crc32c.js";
import { deriveSolanaKey } from "../src/keys.js";

test("crc32c matches the standard check value", () => {
  assert.equal(crc32c(new TextEncoder().encode("123456789")), 0xe3069283);
  assert.equal(crc32c(new Uint8Array()), 0);
});

test("derives the Solana address from an Ed25519 public key", () => {
  const keypair = Keypair.generate();
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const spki = Buffer.concat([der.subarray(0, der.length - 32), Buffer.from(keypair.publicKey.toBytes())]);
  const pem = `-----BEGIN PUBLIC KEY-----\n${spki.toString("base64")}\n-----END PUBLIC KEY-----\n`;
  const derived = deriveSolanaKey(pem);
  assert.equal(derived.address, keypair.publicKey.toBase58());
  assert.equal(derived.publicKey, derived.address);
});

test("rejects a key of the wrong algorithm", () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).publicKey.export({ format: "pem", type: "spki" }).toString();
  assert.throws(() => deriveSolanaKey(ec), /expected an Ed25519/);
});

const ring = "projects/colosseum-eox/locations/us-central1/keyRings/eox-signing-dev/cryptoKeys";
const retired = {
  role: "uma-asserter",
  environment: "dev",
  chain: "evm",
  network: "eip155:11155111",
  algorithm: "secp256k1",
  publicKey: "0x04",
  address: "0x70bA88a9f3c35aa2E07aBFa74A487A2410553634",
  keyVersion: `${ring}/uma-asserter/cryptoKeyVersions/1`,
  state: "retired",
  validFrom: 0,
  validUntil: 1_791_700_000,
};
const validConfig = () => ({
  environment: "dev",
  audience: "",
  keys: { "oracle-operator": { keyVersion: `${ring}/oracle-operator/cryptoKeyVersions/1`, network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", validFrom: 0 } },
  callers: {},
  bindings: {},
  directoryVersion: 2,
  retired: [retired],
});

function writeConfig(value: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "signer-config-")), "config.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

test("loads a valid config and rejects unsafe ones", () => {
  assert.equal(loadSignerConfig(writeConfig(validConfig())).environment, "dev");
  const wrongNetwork = validConfig();
  wrongNetwork.keys["oracle-operator"].network = "eip155:11155111";
  assert.throws(() => loadSignerConfig(writeConfig(wrongNetwork)), /not a Solana network/);
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), callers: { "joel@gmail.com": ["oracle-operator"] } })), /not a service account/);
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), callers: { "cox-publisher@colosseum-eox.iam.gserviceaccount.com": ["uma-asserter"] } })), /unknown role/);
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), bindings: { "uma-asserter": { solana: { maxComputeUnitPriceMicroLamports: "1", programs: [] } } } })), /unknown role/);
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), bindings: { "oracle-operator": { evm: {} } } })), /only Solana programs/);
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), directoryVersion: 0 })), /directoryVersion/);
});

test("accepts only genuinely retired entries in the directory history", () => {
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), retired: [{ ...retired, role: "oracle-operator" }] })), /still a signing role/);
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), retired: [{ ...retired, state: "active" }] })), /retired entry/);
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), retired: [{ ...retired, validUntil: null }] })), /retired entry/);
});
