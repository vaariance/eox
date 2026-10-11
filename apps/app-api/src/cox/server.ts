import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { COX_APP_API_SCHEMA_VERSION, type CoxErrorCode, type CoxPublicationEvent, type CoxPublicationPage, type Publication } from "@eox/app-api";
import type { CoxSource } from "./source.js";

const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;
const HEARTBEAT_MS = 15_000;
const SEQUENCE_PATTERN = /^(0|[1-9][0-9]{0,15})$/;
const ASSET_PATTERN = /^[A-Z0-9]{2,12}$/;
const OWNER_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: CoxErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface CoxApiServerOptions {
  source: CoxSource;
  now?: () => number;
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

function sequence(value: string, name: string): number {
  if (!SEQUENCE_PATTERN.test(value)) throw new ApiError(400, "INVALID_REQUEST", `invalid ${name}`);
  return Number(value);
}

function after(value: string | null | undefined): number | null {
  return value === null || value === undefined || value === "" ? null : sequence(value, "after");
}

const event = (publication: Publication): CoxPublicationEvent => ({ sequence: publication.identity.sequence, publication });

export function createCoxApiServer(options: CoxApiServerOptions): Server {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const { source } = options;

  async function send(res: ServerResponse, data: unknown, at = now()): Promise<void> {
    const [deployment, status] = await Promise.all([source.deployment(), source.status(at)]);
    write(res, 200, { schemaVersion: COX_APP_API_SCHEMA_VERSION, deployment, status, data });
  }

  async function publication(res: ServerResponse, which: string): Promise<void> {
    const at = now();
    const all = await source.publications(at);
    if (which === "latest") {
      const latest = all.at(-1);
      if (!latest) throw new ApiError(404, "NO_PUBLICATION", "no publication has been committed yet");
      return send(res, latest, at);
    }
    const wanted = sequence(which, "sequence");
    const found = all.find((p) => p.identity.sequence === wanted);
    if (!found) throw new ApiError(404, "PUBLICATION_NOT_FOUND", `publication ${wanted} not found`);
    return send(res, found, at);
  }

  async function page(url: URL, res: ServerResponse): Promise<void> {
    const from = after(url.searchParams.get("after"));
    const limitText = url.searchParams.get("limit");
    const limit = limitText === null ? DEFAULT_PAGE : sequence(limitText, "limit");
    if (limit < 1 || limit > MAX_PAGE) throw new ApiError(400, "INVALID_REQUEST", `limit must be between 1 and ${MAX_PAGE}`);
    const at = now();
    const events = (await source.publications(at)).filter((p) => from === null || p.identity.sequence > from).slice(0, limit).map(event);
    const body: CoxPublicationPage = { events, nextAfter: events.at(-1)?.sequence ?? from };
    return send(res, body, at);
  }

  async function stream(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    const header = req.headers["last-event-id"];
    let last = after(Array.isArray(header) ? header[0] : header ?? url.searchParams.get("after"));
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" });
    const emit = (p: Publication) => {
      if (last !== null && p.identity.sequence <= last) return;
      last = p.identity.sequence;
      res.write(`id: ${last}\nevent: publication\ndata: ${JSON.stringify(event(p))}\n\n`);
    };
    const unsubscribe = source.onPublication(emit);
    for (const p of await source.publications(now())) emit(p);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET") {
      res.setHeader("allow", "GET");
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "method not allowed");
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") return write(res, 200, { status: "ok" });
    const path = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (path[0] !== "v1") throw new ApiError(404, "NOT_FOUND", "not found");
    const [, a, b, c] = path;
    if (path.length === 2 && a === "deployment") return send(res, await source.deployment());
    if (path.length === 2 && a === "status") return send(res, await source.status(now()));
    if (path.length === 2 && a === "crypto") return send(res, await source.crypto());
    if (path.length === 2 && a === "assets") return send(res, await source.assets(now()));
    if (path.length === 3 && a === "assets") {
      if (!ASSET_PATTERN.test(b!)) throw new ApiError(400, "INVALID_REQUEST", "invalid asset");
      const asset = (await source.assets(now())).find((x) => x.assetId === b);
      if (!asset) throw new ApiError(404, "UNKNOWN_ASSET", `asset ${b} is not in the roster`);
      return send(res, asset);
    }
    if (path.length === 2 && a === "publications") return page(url, res);
    if (path.length === 3 && a === "publications" && b === "stream") return stream(req, url, res);
    if (path.length === 3 && a === "publications") return publication(res, b!);
    if (path.length === 4 && a === "wallets" && c === "portfolio") {
      if (!OWNER_PATTERN.test(b!)) throw new ApiError(400, "INVALID_REQUEST", "invalid owner");
      const portfolio = await source.portfolio(b!);
      if (!portfolio) throw new ApiError(404, "UNKNOWN_WALLET", "wallet has no positions or requests");
      return send(res, portfolio);
    }
    throw new ApiError(404, "NOT_FOUND", "not found");
  }

  return createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const body = (code: CoxErrorCode, message: string) => ({ schemaVersion: COX_APP_API_SCHEMA_VERSION, error: { code, message } });
      if (error instanceof ApiError) return write(res, error.status, body(error.code, error.message));
      if (error instanceof URIError) return write(res, 400, body("INVALID_REQUEST", "invalid path encoding"));
      options.onError?.(error);
      if (!res.headersSent) write(res, 500, body("INTERNAL_ERROR", "internal error"));
    });
  });
}
