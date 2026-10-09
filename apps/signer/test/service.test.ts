import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { keccak256, recoverTransactionAddress, serializeTransaction, type Hex } from "viem";
import { privateKeyToAccount, sign as signHash } from "viem/accounts";
import { SIGNING_SCHEMA_VERSION, type SignRequest, type SigningRole } from "@eox/signing";
import type { SignerConfig } from "../src/config.js";
import type { ResolvedKey } from "../src/directory.js";
import { parseUnsignedTransaction } from "../src/evm.js";
import { createSignerServer } from "../src/server.js";
import { createSigningService, SignerUnavailable, type ChainSigners } from "../src/service.js";
import { verifyEd25519 } from "../src/solana.js";
import type { DecisionStore, StoredDecision } from "../src/store.js";

const NOW = 1_900_000_000;
const SOLANA_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM_NETWORK = "eip155:11155111";
const caller = "eox-worker@colosseum-eox.iam.gserviceaccount.com";
const relay = "eox-relay@colosseum-eox.iam.gserviceaccount.com";
const contract = "0x1111111111111111111111111111111111111111";
const program = Keypair.generate().publicKey;
const discriminator = "0102030405060708";

const evmPrivateKey = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318" as const;
const evmAccount = privateKeyToAccount(evmPrivateKey);
const ed = generateKeyPairSync("ed25519");
const edRaw = new Uint8Array(ed.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const solanaSigner = new PublicKey(edRaw);

function resolved(role: SigningRole, chain: "solana" | "evm", keyVersion: string, network: string, address: string, raw: Uint8Array): ResolvedKey {
  return {
    derived: { chain, publicKey: address, address, rawPublicKey: raw },
    entry: { role, environment: "dev", chain, network, algorithm: chain === "solana" ? "ed25519" : "secp256k1", publicKey: address, address, keyVersion, state: "active", validFrom: 0, validUntil: null },
  };
}

const keys = new Map<string, ResolvedKey>([
  ["oracle-operator", resolved("oracle-operator", "solana", "kv/oracle-operator/1", SOLANA_NETWORK, solanaSigner.toBase58(), edRaw)],
  ["uma-asserter", resolved("uma-asserter", "evm", "kv/uma-asserter/1", EVM_NETWORK, evmAccount.address, new Uint8Array())],
]);

const config = {
  environment: "dev",
  audience: "https://signer.test",
  keys: {},
  callers: { [caller]: ["oracle-operator", "uma-asserter"], [relay]: ["uma-asserter"] },
  bindings: {
    "uma-asserter": { evm: { maxFeePerGasWei: "100000000000", maxGas: "500000", contracts: [{ address: contract, selectors: ["0xa9059cbb"], maxValueWei: "0" }] } },
    "oracle-operator": { solana: { maxComputeUnitPriceMicroLamports: "1000", programs: [{ programId: program.toBase58(), discriminators: [discriminator] }] } },
  },
} as unknown as SignerConfig;

class MemoryStore implements DecisionStore {
  readonly records = new Map<string, StoredDecision>();
  async get(requestId: string) {
    return this.records.get(requestId) ?? null;
  }
  async create(decision: StoredDecision) {
    if (this.records.has(decision.requestId)) return "exists" as const;
    this.records.set(decision.requestId, decision);
    return "created" as const;
  }
}

function harness(options: { failSigning?: boolean } = {}) {
  const store = new MemoryStore();
  const calls = { solana: 0, evm: 0 };
  const signers: ChainSigners = {
    async solana(_keyVersion, _raw, transactionBase64) {
      calls.solana++;
      if (options.failSigning) throw new Error("KMS unavailable");
      const transaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, "base64"));
      const signature = new Uint8Array(edSign(null, transaction.message.serialize(), ed.privateKey));
      transaction.addSignature(solanaSigner, signature);
      return { signature, signedTransaction: Buffer.from(transaction.serialize()).toString("base64") };
    },
    async evm(_keyVersion, _address, unsignedTransactionHex) {
      calls.evm++;
      if (options.failSigning) throw new Error("KMS unavailable");
      const signature = await signHash({ hash: keccak256(unsignedTransactionHex), privateKey: evmPrivateKey });
      const yParity = signature.yParity as 0 | 1;
      const normalized = { r: signature.r, s: signature.s, yParity };
      return { signature: normalized, signedTransaction: serializeTransaction(parseUnsignedTransaction(unsignedTransactionHex), normalized) };
    },
  };
  const sign = createSigningService({ config, keys, store, signers, now: () => NOW, log: () => {} });
  return { sign, store, calls };
}

const unsignedEvm = (data: Hex = "0xa9059cbb0000") =>
  serializeTransaction({ type: "eip1559", chainId: 11155111, nonce: 0, to: contract, data, value: 0n, gas: 100_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });

const evmRequest = (overrides: Partial<SignRequest> = {}) => ({
  schemaVersion: SIGNING_SCHEMA_VERSION,
  chain: "evm",
  requestId: "req-evm-0001",
  role: "uma-asserter",
  keyVersion: "kv/uma-asserter/1",
  network: EVM_NETWORK,
  operation: { operationId: "proposal-1/assert-0", kind: "assert_evidence" },
  expiresAt: NOW + 60,
  unsignedTransactionHex: unsignedEvm(),
  ...overrides,
});

function solanaRequest(overrides: Record<string, unknown> = {}) {
  const message = new TransactionMessage({
    payerKey: solanaSigner,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [new TransactionInstruction({ programId: program, keys: [{ pubkey: solanaSigner, isSigner: true, isWritable: true }], data: Buffer.from(discriminator, "hex") })],
  }).compileToV0Message();
  return {
    schemaVersion: SIGNING_SCHEMA_VERSION,
    chain: "solana",
    requestId: "req-sol-0001",
    role: "oracle-operator",
    keyVersion: "kv/oracle-operator/1",
    network: SOLANA_NETWORK,
    operation: { operationId: "proposal-1/upload-0", kind: "upload_evidence_page" },
    expiresAt: NOW + 60,
    transactionBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    ...overrides,
  };
}

test("signs a bound EVM call and returns the recorded result on retry without signing again", async () => {
  const { sign, calls } = harness();
  const first = await sign(caller, evmRequest());
  assert.equal(first.decision, "signed");
  assert.equal(first.decision === "signed" && (await recoverTransactionAddress({ serializedTransaction: first.signedTransaction as `0x02${string}` })), evmAccount.address);
  const second = await sign(caller, evmRequest());
  assert.deepEqual(second, first);
  assert.equal(calls.evm, 1);
});

test("signs a bound Solana instruction with a verifiable signature", async () => {
  const { sign } = harness();
  const result = await sign(caller, solanaRequest());
  assert.equal(result.decision, "signed");
  const transaction = VersionedTransaction.deserialize(Buffer.from(result.decision === "signed" ? result.signedTransaction : "", "base64"));
  assert.equal(verifyEd25519(edRaw, transaction.message.serialize(), transaction.signatures[0]!), true);
});

test("rejects a request id reused with different bytes or by another caller", async () => {
  const { sign } = harness();
  await sign(caller, evmRequest());
  const changed = await sign(caller, evmRequest({ unsignedTransactionHex: unsignedEvm("0xa9059cbb0001") } as Partial<SignRequest>));
  assert.equal(changed.decision === "rejected" && changed.code, "REQUEST_ID_CONFLICT");
  const otherCaller = await sign(relay, evmRequest());
  assert.equal(otherCaller.decision === "rejected" && otherCaller.code, "REQUEST_ID_CONFLICT");
});

test("records rejections and replays them for identical retries", async () => {
  const { sign, store, calls } = harness();
  const cases: [Record<string, unknown>, string, string][] = [
    [evmRequest({ requestId: "req-role-0001", role: "oracle-checker" } as Partial<SignRequest>), caller, "ROLE_NOT_PERMITTED"],
    [evmRequest({ requestId: "req-key-00001", keyVersion: "kv/uma-asserter/2" }), caller, "KEY_NOT_ACTIVE"],
    [evmRequest({ requestId: "req-net-00001", network: "eip155:1" }), caller, "NETWORK_NOT_PERMITTED"],
    [evmRequest({ requestId: "req-exp-00001", expiresAt: NOW + 601 }), caller, "INVALID_REQUEST"],
    [evmRequest({ requestId: "req-sel-00001", unsignedTransactionHex: unsignedEvm("0x095ea7b30000") } as Partial<SignRequest>), caller, "OPERATION_NOT_PERMITTED"],
    [solanaRequest({ requestId: "req-sol-role1" }), relay, "ROLE_NOT_PERMITTED"],
  ];
  for (const [request, who, code] of cases) {
    const result = await sign(who, request);
    assert.equal(result.decision === "rejected" && result.code, code, String(request.requestId));
    assert.deepEqual(await sign(who, request), result);
    assert.ok(store.records.has(String(request.requestId)));
  }
  assert.equal(calls.evm + calls.solana, 0);
});

test("rejects malformed and expired requests without recording them", async () => {
  const { sign, store } = harness();
  const expired = await sign(caller, evmRequest({ requestId: "req-old-00001", expiresAt: NOW }));
  assert.equal(expired.decision === "rejected" && expired.code, "REQUEST_EXPIRED");
  const wrongSchema = await sign(caller, { ...evmRequest(), schemaVersion: "eox.signing/v0" });
  assert.equal(wrongSchema.decision === "rejected" && wrongSchema.code, "INVALID_REQUEST");
  assert.equal(store.records.size, 0);
});

test("does not record a decision when KMS signing fails", async () => {
  const { sign, store } = harness({ failSigning: true });
  await assert.rejects(sign(caller, evmRequest()), SignerUnavailable);
  assert.equal(store.records.size, 0);
});

test("concurrent identical requests return one recorded result", async () => {
  const { sign } = harness();
  const [a, b] = await Promise.all([sign(caller, evmRequest()), sign(caller, evmRequest())]);
  assert.equal(a.decision, "signed");
  assert.deepEqual(b.decision, "signed");
});

test("the HTTP layer authenticates callers and checks routes", async () => {
  const { sign } = harness();
  const server = createSignerServer({
    verifyCaller: async (authorization) => (authorization === "Bearer good" ? caller : null),
    sign,
    directory: () => ({ schemaVersion: SIGNING_SCHEMA_VERSION, environment: "dev", version: 1, generatedAt: NOW, entries: [] }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, auth = "Bearer good") =>
    fetch(`${base}${path}`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/v1/keys`)).status, 401);
    assert.equal((await fetch(`${base}/v1/keys`, { headers: { authorization: "Bearer good" } })).status, 200);
    assert.equal((await post("/v1/sign/evm", evmRequest(), "Bearer bad")).status, 401);
    assert.equal((await post("/v1/sign/solana", evmRequest())).status, 400);
    assert.equal((await post("/v1/sign/evm", evmRequest())).status, 200);
    assert.equal((await post("/v1/sign/evm", evmRequest({ requestId: "req-http-role", role: "oracle-checker" } as Partial<SignRequest>))).status, 403);
    assert.equal((await post("/v1/sign/evm", { pad: "x".repeat(200_000) })).status, 413);
    assert.equal((await fetch(`${base}/v1/sign/evm`, { headers: { authorization: "Bearer good" } })).status, 405);
  } finally {
    server.close();
  }
});
