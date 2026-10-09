import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { serializeSignature, type Hex } from "viem";
import {
  SIGNING_SCHEMA_VERSION,
  SigningClientError,
  validateSignRequest,
  type RejectionCode,
  type SignRequest,
  type SignResult,
} from "@eox/signing";
import type { SignerConfig } from "./config.js";
import type { ResolvedKey } from "./directory.js";
import { parseUnsignedTransaction } from "./evm.js";
import { checkEvmPolicy, checkSolanaPolicy, PolicyRejection } from "./policy.js";
import { parseSolanaTransaction, requiredSignerIndex } from "./solana.js";
import type { DecisionStore } from "./store.js";

export const MAX_EXPIRY_SECONDS = 600;

export interface ChainSigners {
  solana(keyVersion: string, rawPublicKey: Uint8Array, transactionBase64: string): Promise<{ signature: Uint8Array; signedTransaction: string }>;
  evm(keyVersion: string, address: string, unsignedTransactionHex: Hex): Promise<{ signature: { r: Hex; s: Hex; yParity: 0 | 1 }; signedTransaction: Hex }>;
}

export class SignerUnavailable extends Error {}

export interface SigningServiceDeps {
  config: SignerConfig;
  keys: Map<string, ResolvedKey>;
  store: DecisionStore;
  signers: ChainSigners;
  now: () => number;
  log: (entry: Record<string, unknown>) => void;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requestDigest(request: SignRequest): string {
  const { requestId, role, keyVersion, network, operation, expiresAt, chain } = request;
  const bytes = chain === "solana" ? request.transactionBase64 : request.unsignedTransactionHex;
  return createHash("sha256")
    .update(canonical({ requestId, role, keyVersion, network, operation, expiresAt, chain, bytes }))
    .digest("hex");
}

function payloadDigest(request: SignRequest): string {
  const bytes =
    request.chain === "solana"
      ? Buffer.from(request.transactionBase64, "base64")
      : Buffer.from(request.unsignedTransactionHex.slice(2), "hex");
  return createHash("sha256").update(bytes).digest("hex");
}

export function createSigningService(deps: SigningServiceDeps) {
  const { config, keys, store, signers, now, log } = deps;

  function rejection(requestId: string, payloadSha256: string | null, code: RejectionCode, reason: string): SignResult {
    return { schemaVersion: SIGNING_SCHEMA_VERSION, requestId, decision: "rejected", payloadSha256, code, reason, decidedAt: now() };
  }

  async function decide(caller: string, request: SignRequest, payloadSha256: string): Promise<SignResult> {
    const roles = config.callers[caller] ?? [];
    if (!roles.includes(request.role)) {
      return rejection(request.requestId, payloadSha256, "ROLE_NOT_PERMITTED", `${caller} may not sign as ${request.role}`);
    }
    const key = keys.get(request.role);
    if (!key || key.entry.state !== "active" || key.entry.keyVersion !== request.keyVersion) {
      return rejection(request.requestId, payloadSha256, "KEY_NOT_ACTIVE", `key version ${request.keyVersion} is not active for ${request.role}`);
    }
    if (request.network !== key.entry.network) {
      return rejection(request.requestId, payloadSha256, "NETWORK_NOT_PERMITTED", `${request.role} signs only on ${key.entry.network}`);
    }
    if (request.expiresAt > now() + MAX_EXPIRY_SECONDS) {
      return rejection(request.requestId, payloadSha256, "INVALID_REQUEST", `expiry must be within ${MAX_EXPIRY_SECONDS} seconds`);
    }
    const bindings = config.bindings[request.role];
    try {
      if (request.chain === "evm") {
        const transaction = parseUnsignedTransaction(request.unsignedTransactionHex as Hex);
        checkEvmPolicy(request.role, bindings, request.network, transaction);
      } else {
        const transaction = parseSolanaTransaction(request.transactionBase64);
        const signer = new PublicKey(key.derived.rawPublicKey);
        requiredSignerIndex(transaction, signer);
        checkSolanaPolicy(request.role, bindings, transaction, signer);
      }
    } catch (error) {
      if (error instanceof PolicyRejection) return rejection(request.requestId, payloadSha256, error.code, error.message);
      return rejection(request.requestId, payloadSha256, "INVALID_REQUEST", error instanceof Error ? error.message : "invalid transaction");
    }
    try {
      let signature: string;
      let signedTransaction: string;
      if (request.chain === "evm") {
        const signed = await signers.evm(key.entry.keyVersion, key.entry.address, request.unsignedTransactionHex as Hex);
        signature = serializeSignature(signed.signature);
        signedTransaction = signed.signedTransaction;
      } else {
        const signed = await signers.solana(key.entry.keyVersion, key.derived.rawPublicKey, request.transactionBase64);
        signature = Buffer.from(signed.signature).toString("base64");
        signedTransaction = signed.signedTransaction;
      }
      return {
        schemaVersion: SIGNING_SCHEMA_VERSION,
        requestId: request.requestId,
        decision: "signed",
        payloadSha256,
        signer: { role: request.role, address: key.entry.address, keyVersion: key.entry.keyVersion },
        signature,
        signedTransaction,
        decidedAt: now(),
      };
    } catch (error) {
      throw new SignerUnavailable(error instanceof Error ? error.message : "signing failed");
    }
  }

  async function replay(caller: string, request: SignRequest, digest: string): Promise<SignResult | null> {
    const existing = await store.get(request.requestId);
    if (!existing) return null;
    if (existing.caller === caller && existing.requestSha256 === digest) return existing.result;
    return rejection(request.requestId, null, "REQUEST_ID_CONFLICT", "this request id was already used for a different request");
  }

  return async function sign(caller: string, body: unknown): Promise<SignResult> {
    const request = body as SignRequest & { schemaVersion?: string };
    const requestId = typeof request?.requestId === "string" ? request.requestId : "";
    if (request?.schemaVersion !== SIGNING_SCHEMA_VERSION) {
      return rejection(requestId, null, "INVALID_REQUEST", "unsupported schema version");
    }
    try {
      validateSignRequest(request, now());
    } catch (error) {
      const message = error instanceof SigningClientError ? error.message : "invalid request";
      return rejection(requestId, null, message === "request expired" ? "REQUEST_EXPIRED" : "INVALID_REQUEST", message);
    }
    const digest = requestDigest(request);
    const replayed = await replay(caller, request, digest);
    if (replayed) {
      log({ caller, role: request.role, requestId, payloadSha256: replayed.payloadSha256, decision: replayed.decision, replay: true });
      return replayed;
    }
    const payloadSha256 = payloadDigest(request);
    const result = await decide(caller, request, payloadSha256);
    const stored = await store.create({ requestId, caller, role: request.role, requestSha256: digest, result });
    const final = stored === "created" ? result : ((await replay(caller, request, digest)) ?? result);
    log({
      caller,
      role: request.role,
      requestId,
      payloadSha256,
      decision: final.decision,
      code: final.decision === "rejected" ? final.code : undefined,
    });
    return final;
  };
}
