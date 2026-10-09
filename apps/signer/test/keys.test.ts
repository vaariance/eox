import assert from "node:assert/strict";
import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { privateKeyToAddress } from "viem/accounts";
import { loadSignerConfig } from "../src/config.js";
import { crc32c } from "../src/crc32c.js";
import { deriveEvmKey, deriveSolanaKey } from "../src/keys.js";

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

test("derives the EVM address from a secp256k1 public key", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const d = Buffer.from(createPrivateKey(privateKey.export({ format: "pem", type: "pkcs8" })).export({ format: "jwk" }).d!, "base64url");
  const derived = deriveEvmKey(publicKey.export({ format: "pem", type: "spki" }).toString());
  assert.equal(derived.address, privateKeyToAddress(`0x${d.toString("hex")}`));
  assert.match(derived.publicKey, /^0x04[0-9a-f]{128}$/);
});

test("rejects a key of the wrong algorithm", () => {
  const ed = generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString();
  const ec = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).publicKey.export({ format: "pem", type: "spki" }).toString();
  assert.throws(() => deriveEvmKey(ed), /expected a secp256k1/);
  assert.throws(() => deriveSolanaKey(ec), /expected an Ed25519/);
});

const ring = "projects/colosseum-eox/locations/us-central1/keyRings/eox-signing-dev/cryptoKeys";
const validConfig = () => ({
  environment: "dev",
  audience: "",
  keys: Object.fromEntries(
    ["oracle-operator", "solana-relayer", "uma-asserter", "uma-challenger", "oracle-checker", "evm-relayer"].map((role) => [
      role,
      {
        keyVersion: `${ring}/${role}/cryptoKeyVersions/1`,
        network: role === "oracle-operator" || role === "solana-relayer" ? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" : "eip155:11155111",
        validFrom: 0,
      },
    ]),
  ),
  callers: {},
  bindings: {},
});

function writeConfig(value: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "signer-config-")), "config.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

test("loads a valid config and rejects unsafe ones", () => {
  assert.equal(loadSignerConfig(writeConfig(validConfig())).environment, "dev");
  const wrongNetwork = validConfig();
  wrongNetwork.keys["uma-asserter"]!.network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  assert.throws(() => loadSignerConfig(writeConfig(wrongNetwork)), /does not match its chain/);
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), callers: { "joel@gmail.com": ["oracle-operator"] } })), /not a service account/);
  assert.throws(() => loadSignerConfig(writeConfig({ ...validConfig(), bindings: { solana: {} } })), /unknown role/);
  assert.throws(
    () => loadSignerConfig(writeConfig({ ...validConfig(), bindings: { "uma-asserter": { solana: { maxComputeUnitPriceMicroLamports: "1", programs: [] } } } })),
    /cannot bind Solana programs/,
  );
});
