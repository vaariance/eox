import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { SIGNING_SCHEMA_VERSION, type KeyDirectory, type SignResult } from "@eox/signing";
import type { CallerVerifier } from "./auth.js";
import { SignerUnavailable } from "./service.js";

const MAX_BODY_BYTES = 128 * 1024;

export interface SignerServerOptions {
  verifyCaller: CallerVerifier;
  sign: (caller: string, body: unknown) => Promise<SignResult>;
  directory: () => KeyDirectory;
  onError?: (error: unknown) => void;
}

function write(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(text);
}

function error(res: ServerResponse, status: number, code: string, message: string): void {
  write(res, status, { schemaVersion: SIGNING_SCHEMA_VERSION, error: { code, message } });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new SyntaxError("content-type must be application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RangeError("request body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createSignerServer(options: SignerServerOptions): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/health" && req.method === "GET") return write(res, 200, { status: "ok" });
      const caller = await options.verifyCaller(req.headers.authorization);
      if (!caller) return error(res, 401, "UNAUTHENTICATED", "a valid identity token for a registered caller is required");
      if (url.pathname === "/v1/keys") {
        if (req.method !== "GET") return error(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
        return write(res, 200, options.directory());
      }
      const match = /^\/v1\/sign\/(solana|evm)$/.exec(url.pathname);
      if (!match) return error(res, 404, "NOT_FOUND", "not found");
      if (req.method !== "POST") return error(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
      const body = (await readJson(req)) as { chain?: string };
      if (body?.chain !== match[1]) return error(res, 400, "INVALID_REQUEST", "chain does not match the route");
      const result = await options.sign(caller, body);
      return write(res, result.decision === "signed" ? 200 : 403, result);
    } catch (failure) {
      if (failure instanceof SyntaxError) return error(res, 400, "INVALID_REQUEST", failure.message);
      if (failure instanceof RangeError) return error(res, 413, "INVALID_REQUEST", failure.message);
      if (failure instanceof SignerUnavailable) return error(res, 503, "SIGNER_UNAVAILABLE", "signing is temporarily unavailable");
      options.onError?.(failure);
      return error(res, 500, "INTERNAL_ERROR", "internal error");
    }
  });
}
