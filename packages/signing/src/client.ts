import {
  ROLE_CHAINS,
  SIGNING_ROLES,
  SIGNING_SCHEMA_VERSION,
  type KeyDirectory,
  type KeyDirectoryEntry,
  type RemoteSigner,
  type SignEvmTransactionRequest,
  type SignRequest,
  type SignResult,
  type SignSolanaTransactionRequest,
  type SigningRole,
} from "./types.js";

export interface SigningClientOptions {
  baseUrl: string;
  identityToken: () => Promise<string>;
  fetch?: typeof fetch;
}

export class SigningClientError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "SigningClientError";
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const NETWORK_PATTERN = /^(eip155:[0-9]{1,20}|solana:[1-9A-HJ-NP-Za-km-z]{32})$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const HEX_PATTERN = /^0x([0-9a-f]{2})+$/;

export function validateSignRequest(request: SignRequest, nowSeconds: number): void {
  if (!REQUEST_ID_PATTERN.test(request.requestId)) throw new SigningClientError("invalid request id", 0);
  if (!SIGNING_ROLES.includes(request.role)) throw new SigningClientError(`unknown role ${request.role}`, 0);
  if (ROLE_CHAINS[request.role] !== request.chain) {
    throw new SigningClientError(`role ${request.role} does not sign for ${request.chain}`, 0);
  }
  if (!NETWORK_PATTERN.test(request.network)) throw new SigningClientError("invalid network", 0);
  if (request.chain === "evm" !== request.network.startsWith("eip155:")) {
    throw new SigningClientError("network does not match chain", 0);
  }
  if (!request.keyVersion) throw new SigningClientError("missing key version", 0);
  if (!request.operation.operationId || !request.operation.kind) throw new SigningClientError("missing operation identity", 0);
  if (!Number.isSafeInteger(request.expiresAt) || request.expiresAt <= nowSeconds) {
    throw new SigningClientError("request expired", 0);
  }
  if (request.chain === "solana" && !BASE64_PATTERN.test(request.transactionBase64)) {
    throw new SigningClientError("invalid Solana transaction bytes", 0);
  }
  if (request.chain === "evm" && !HEX_PATTERN.test(request.unsignedTransactionHex)) {
    throw new SigningClientError("invalid EVM transaction bytes", 0);
  }
}

export function createSigningClient(options: SigningClientOptions): RemoteSigner {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;

  async function call<T extends { schemaVersion: string }>(path: string, init: RequestInit): Promise<T> {
    const token = await options.identityToken();
    const res = await doFetch(`${baseUrl}/v1/${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const body = (await res.json()) as T;
    if (body.schemaVersion !== SIGNING_SCHEMA_VERSION) {
      throw new SigningClientError(`unsupported schema version ${String(body.schemaVersion)}`, res.status);
    }
    return body;
  }

  async function sign(request: SignRequest): Promise<SignResult> {
    validateSignRequest(request, Math.floor(Date.now() / 1000));
    return call<SignResult>(`sign/${request.chain}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: SIGNING_SCHEMA_VERSION, ...request }),
    });
  }

  async function keyDirectory(): Promise<KeyDirectory> {
    return call<KeyDirectory>("keys", { method: "GET" });
  }

  return {
    keyDirectory,
    async getPublicKey(role: SigningRole): Promise<KeyDirectoryEntry> {
      const active = (await keyDirectory()).entries.filter((entry) => entry.role === role && entry.state === "active");
      if (active.length !== 1) throw new SigningClientError(`expected one active key for ${role}, found ${active.length}`, 0);
      return active[0]!;
    },
    signSolanaTransaction: (request: Omit<SignSolanaTransactionRequest, "chain">) => sign({ ...request, chain: "solana" }),
    signEvmTransaction: (request: Omit<SignEvmTransactionRequest, "chain">) => sign({ ...request, chain: "evm" }),
  };
}
