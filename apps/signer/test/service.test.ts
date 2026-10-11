import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { SIGNING_SCHEMA_VERSION } from "@eox/signing";
import type { SignerConfig } from "../src/config.js";
import type { ResolvedKey } from "../src/directory.js";
import { createSignerServer } from "../src/server.js";
import { createSigningService, SignerUnavailable, type ChainSigners } from "../src/service.js";
import { verifyEd25519 } from "../src/solana.js";
import type { DecisionStore, StoredDecision } from "../src/store.js";

const NOW = 1_900_000_000;
const SOLANA_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const caller = "cox-publisher@colosseum-eox.iam.gserviceaccount.com";
const relay = "eox-relay@colosseum-eox.iam.gserviceaccount.com";
const program = Keypair.generate().publicKey;
const discriminator = "0102030405060708";

const ed = generateKeyPairSync("ed25519");
const edRaw = new Uint8Array(ed.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const solanaSigner = new PublicKey(edRaw);

const keys = new Map<string, ResolvedKey>([
  [
    "oracle-operator",
    {
      derived: { chain: "solana", publicKey: solanaSigner.toBase58(), address: solanaSigner.toBase58(), rawPublicKey: edRaw },
      entry: {
        role: "oracle-operator",
        environment: "dev",
        chain: "solana",
        network: SOLANA_NETWORK,
        algorithm: "ed25519",
        publicKey: solanaSigner.toBase58(),
        address: solanaSigner.toBase58(),
        keyVersion: "kv/oracle-operator/1",
        state: "active",
        validFrom: 0,
        validUntil: null,
      },
    },
  ],
]);

const config = {
  environment: "dev",
  audience: "https://signer.test",
  keys: {},
  callers: { [caller]: ["oracle-operator"], [relay]: [] },
  bindings: { "oracle-operator": { solana: { maxComputeUnitPriceMicroLamports: "1000", programs: [{ programId: program.toBase58(), discriminators: [discriminator] }] } } },
  directoryVersion: 2,
  retired: [],
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
  const calls = { solana: 0 };
  const signers: ChainSigners = {
    async solana(_keyVersion, _raw, transactionBase64) {
      calls.solana++;
      if (options.failSigning) throw new Error("KMS unavailable");
      const transaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, "base64"));
      const signature = new Uint8Array(edSign(null, transaction.message.serialize(), ed.privateKey));
      transaction.addSignature(solanaSigner, signature);
      return { signature, signedTransaction: Buffer.from(transaction.serialize()).toString("base64") };
    },
  };
  const sign = createSigningService({ config, keys, store, signers, now: () => NOW, log: () => {} });
  return { sign, store, calls };
}

function solanaRequest(overrides: Record<string, unknown> = {}, data = discriminator) {
  const message = new TransactionMessage({
    payerKey: solanaSigner,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [new TransactionInstruction({ programId: program, keys: [{ pubkey: solanaSigner, isSigner: true, isWritable: true }], data: Buffer.from(data, "hex") })],
  }).compileToV0Message();
  return {
    schemaVersion: SIGNING_SCHEMA_VERSION,
    chain: "solana",
    requestId: "req-sol-0001",
    role: "oracle-operator",
    keyVersion: "kv/oracle-operator/1",
    network: SOLANA_NETWORK,
    operation: { operationId: "batch-1/publish", kind: "cox-publish" },
    expiresAt: NOW + 60,
    transactionBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    ...overrides,
  };
}

test("signs a bound Solana instruction verifiably and returns the recorded result on retry", async () => {
  const { sign, calls } = harness();
  const first = await sign(caller, solanaRequest());
  assert.equal(first.decision, "signed");
  const transaction = VersionedTransaction.deserialize(Buffer.from(first.decision === "signed" ? first.signedTransaction : "", "base64"));
  assert.equal(verifyEd25519(edRaw, transaction.message.serialize(), transaction.signatures[0]!), true);
  assert.deepEqual(await sign(caller, solanaRequest()), first);
  assert.equal(calls.solana, 1);
});

test("rejects a request id reused with different bytes or by another caller", async () => {
  const { sign } = harness();
  await sign(caller, solanaRequest());
  const changed = await sign(caller, solanaRequest({}, "0102030405060709"));
  assert.equal(changed.decision === "rejected" && changed.code, "REQUEST_ID_CONFLICT");
  const otherCaller = await sign(relay, solanaRequest());
  assert.equal(otherCaller.decision === "rejected" && otherCaller.code, "REQUEST_ID_CONFLICT");
});

test("records rejections and replays them for identical retries", async () => {
  const { sign, store, calls } = harness();
  const cases: [Record<string, unknown>, string, string][] = [
    [solanaRequest({ requestId: "req-role-0001" }), relay, "ROLE_NOT_PERMITTED"],
    [solanaRequest({ requestId: "req-key-00001", keyVersion: "kv/oracle-operator/2" }), caller, "KEY_NOT_ACTIVE"],
    [solanaRequest({ requestId: "req-net-00001", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }), caller, "NETWORK_NOT_PERMITTED"],
    [solanaRequest({ requestId: "req-exp-00001", expiresAt: NOW + 601 }), caller, "INVALID_REQUEST"],
    [solanaRequest({ requestId: "req-ins-00001" }, "ffffffffffffffff"), caller, "OPERATION_NOT_PERMITTED"],
  ];
  for (const [request, who, code] of cases) {
    const result = await sign(who, request);
    assert.equal(result.decision === "rejected" && result.code, code, String(request.requestId));
    assert.deepEqual(await sign(who, request), result);
    assert.ok(store.records.has(String(request.requestId)));
  }
  assert.equal(calls.solana, 0);
});

test("rejects malformed, EVM, retired-role and expired requests without recording them", async () => {
  const { sign, store } = harness();
  const expired = await sign(caller, solanaRequest({ requestId: "req-old-00001", expiresAt: NOW }));
  assert.equal(expired.decision === "rejected" && expired.code, "REQUEST_EXPIRED");
  const wrongSchema = await sign(caller, { ...solanaRequest(), schemaVersion: "eox.signing/v0" });
  assert.equal(wrongSchema.decision === "rejected" && wrongSchema.code, "INVALID_REQUEST");
  const evm = await sign(caller, { ...solanaRequest({ requestId: "req-evm-00001" }), chain: "evm" });
  assert.equal(evm.decision === "rejected" && evm.code, "INVALID_REQUEST");
  const retired = await sign(caller, solanaRequest({ requestId: "req-ret-00001", role: "uma-asserter" }));
  assert.equal(retired.decision === "rejected" && retired.code, "INVALID_REQUEST");
  assert.equal(store.records.size, 0);
});

test("does not record a decision when KMS signing fails", async () => {
  const { sign, store } = harness({ failSigning: true });
  await assert.rejects(sign(caller, solanaRequest()), SignerUnavailable);
  assert.equal(store.records.size, 0);
});

test("concurrent identical requests return one recorded result", async () => {
  const { sign } = harness();
  const [a, b] = await Promise.all([sign(caller, solanaRequest()), sign(caller, solanaRequest())]);
  assert.equal(a.decision, "signed");
  assert.deepEqual(b.decision, "signed");
});

test("the HTTP layer authenticates callers, serves only the Solana route and checks methods", async () => {
  const { sign } = harness();
  const server = createSignerServer({
    verifyCaller: async (authorization) => (authorization === "Bearer good" ? caller : null),
    sign,
    directory: () => ({ schemaVersion: SIGNING_SCHEMA_VERSION, environment: "dev", version: 2, generatedAt: NOW, entries: [] }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, auth = "Bearer good") =>
    fetch(`${base}${path}`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/v1/keys`)).status, 401);
    assert.equal((await fetch(`${base}/v1/keys`, { headers: { authorization: "Bearer good" } })).status, 200);
    assert.equal((await post("/v1/sign/solana", solanaRequest(), "Bearer bad")).status, 401);
    assert.equal((await post("/v1/sign/solana", solanaRequest())).status, 200);
    assert.equal((await post("/v1/sign/evm", solanaRequest())).status, 404);
    assert.equal((await post("/v1/sign/solana", { ...solanaRequest(), chain: "evm" })).status, 400);
    assert.equal((await post("/v1/sign/solana", solanaRequest({ requestId: "req-http-role", role: "uma-asserter" }))).status, 403);
    assert.equal((await post("/v1/sign/solana", { pad: "x".repeat(200_000) })).status, 413);
    assert.equal((await fetch(`${base}/v1/sign/solana`, { headers: { authorization: "Bearer good" } })).status, 405);
  } finally {
    server.close();
  }
});
