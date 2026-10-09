import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSignRequest, type SignRequest } from "../src/index.js";

const now = 1_900_000_000;
const solana: SignRequest = {
  chain: "solana",
  requestId: "req-0001-oracle",
  role: "oracle-operator",
  keyVersion: "oracle-operator/dev/1",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  operation: { operationId: "proposal-42/upload-0", kind: "upload_evidence_page" },
  expiresAt: now + 60,
  transactionBase64: "AQIDBA==",
};
const evm: SignRequest = {
  chain: "evm",
  requestId: "req-0002-asserter",
  role: "uma-asserter",
  keyVersion: "uma-asserter/dev/1",
  network: "eip155:11155111",
  operation: { operationId: "proposal-42/assert-evidence-0", kind: "assert_evidence" },
  expiresAt: now + 60,
  unsignedTransactionHex: "0x02f8",
};

test("accepts well-formed requests for each chain", () => {
  validateSignRequest(solana, now);
  validateSignRequest(evm, now);
});

test("rejects a role signing for the wrong chain", () => {
  assert.throws(() => validateSignRequest({ ...evm, role: "oracle-operator" } as SignRequest, now), /does not sign for evm/);
  assert.throws(() => validateSignRequest({ ...solana, role: "uma-asserter" } as SignRequest, now), /does not sign for solana/);
});

test("rejects a network that does not match the chain", () => {
  assert.throws(() => validateSignRequest({ ...solana, network: "eip155:11155111" }, now), /network does not match chain/);
  assert.throws(() => validateSignRequest({ ...evm, network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" }, now), /network does not match chain/);
});

test("rejects expired requests, unknown roles and malformed fields", () => {
  assert.throws(() => validateSignRequest({ ...solana, expiresAt: now }, now), /request expired/);
  assert.throws(() => validateSignRequest({ ...solana, role: "admin" } as unknown as SignRequest, now), /unknown role/);
  assert.throws(() => validateSignRequest({ ...solana, requestId: "x" }, now), /invalid request id/);
  assert.throws(() => validateSignRequest({ ...solana, transactionBase64: "not base64!" }, now), /invalid Solana transaction bytes/);
  assert.throws(() => validateSignRequest({ ...evm, unsignedTransactionHex: "02f8" }, now), /invalid EVM transaction bytes/);
  assert.throws(() => validateSignRequest({ ...evm, operation: { operationId: "", kind: "assert" } }, now), /missing operation identity/);
});
