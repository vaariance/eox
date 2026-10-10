import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";

import type { Hex } from "viem";

import { type AssertionReceipt, AsserterError, type EvidenceRequest } from "./asserter.js";
import type { CallerVerifier } from "./auth.js";

export const SCHEMA_VERSION = "eox.uma-relay/v1";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const WORD_PATTERN = /^0x[0-9a-f]{64}$/;
const BYTES_PATTERN = /^0x([0-9a-f]{2})+$/;

export interface AssertionService {
  assertEvidence(request: EvidenceRequest): Promise<AssertionReceipt>;
  assertSnapshot(claim: Hex): Promise<AssertionReceipt>;
}

export interface AssertionServerOptions {
  verifyCaller: CallerVerifier;
  asserter: AssertionService;
  onRequest?(caller: string, route: string, receipt: AssertionReceipt): void;
  onError?(error: unknown): void;
}

class InvalidRequest extends Error {}

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
  write(res, status, { schemaVersion: SCHEMA_VERSION, error: { code, message } });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new InvalidRequest("content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RangeError("request body too large");
    chunks.push(chunk as Buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidRequest("body is not valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new InvalidRequest("body must be an object");
  return body as Record<string, unknown>;
}

function field(body: Record<string, unknown>, name: string, pattern: RegExp): Hex {
  const value = body[name];
  if (typeof value !== "string" || !pattern.test(value)) throw new InvalidRequest(`${name} must be lowercase 0x hex`);
  return value as Hex;
}

export function createAssertionServer(options: AssertionServerOptions): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/health" && req.method === "GET") return write(res, 200, { status: "ok" });
      const caller = await options.verifyCaller(req.headers.authorization);
      if (!caller) return error(res, 401, "UNAUTHENTICATED", "a valid identity token for a registered caller is required");
      const match = /^\/v1\/assertions\/(evidence|snapshot)$/.exec(url.pathname);
      if (!match) return error(res, 404, "NOT_FOUND", "not found");
      if (req.method !== "POST") return error(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");

      const body = await readJson(req);
      const claim = field(body, "claim", BYTES_PATTERN);
      const receipt =
        match[1] === "evidence"
          ? await options.asserter.assertEvidence({
              proposal: field(body, "proposal", WORD_PATTERN),
              precommitment: field(body, "precommitment", WORD_PATTERN),
              claim,
            })
          : await options.asserter.assertSnapshot(claim);
      options.onRequest?.(caller, match[1]!, receipt);
      return write(res, 200, { schemaVersion: SCHEMA_VERSION, ...receipt });
    } catch (failure) {
      if (failure instanceof InvalidRequest) return error(res, 400, "INVALID_REQUEST", failure.message);
      if (failure instanceof RangeError) return error(res, 413, "INVALID_REQUEST", failure.message);
      if (failure instanceof AsserterError) {
        return error(res, failure.code === "CLAIM_REJECTED" ? 422 : 503, failure.code, failure.message);
      }
      options.onError?.(failure);
      return error(res, 500, "INTERNAL_ERROR", "internal error");
    }
  });
}
