import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  APP_API_SCHEMA_VERSION,
  STALE_AFTER_SECONDS,
  type ApiErrorBody,
  type ApiResponse,
  type CountryWorldReference,
  type ErrorCode,
  type PairReference,
  type PublicationEvent,
  type PublicationPage,
  type ReferenceSnapshot,
  type Status,
} from "@eox/app-api";
import type { PublishedSnapshot, ReferenceSource } from "./source.js";

const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const SNAPSHOT_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/;
const SEQUENCE_PATTERN = /^(0|[1-9][0-9]{0,15})$/;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;
const HEARTBEAT_MS = 15_000;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AppApiServerOptions {
  source: ReferenceSource;
  now?: () => number;
  onError?: (error: unknown) => void;
}

function toSnapshot(snapshot: PublishedSnapshot): ReferenceSnapshot {
  return { snapshot: snapshot.identity, multiplier: snapshot.multiplier, world: snapshot.world, countries: snapshot.countries };
}

function toEvent(snapshot: PublishedSnapshot): PublicationEvent {
  return { sequence: snapshot.identity.sequence, snapshot: snapshot.identity };
}

function parseSequence(value: string | null | undefined, name: string): number {
  if (value === null || value === undefined || value === "") return 0;
  if (!SEQUENCE_PATTERN.test(value)) throw new ApiError(400, "INVALID_REQUEST", `invalid ${name}`);
  return Number(value);
}

export function createAppApiServer(options: AppApiServerOptions): Server {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const { source } = options;

  async function status(): Promise<Status> {
    const latest = (await source.publications()).at(-1);
    const asOf = now();
    const age = latest ? asOf - latest.identity.publishedAt : null;
    const stale = age === null || age > STALE_AFTER_SECONDS;
    const paused = await source.paused();
    return {
      asOf,
      latestSequence: latest?.identity.sequence ?? null,
      referenceAgeSeconds: age,
      staleAfterSeconds: STALE_AFTER_SECONDS,
      stale,
      paused,
      eligibleForExecution: latest !== undefined && !stale && !paused,
    };
  }

  async function send<T>(res: ServerResponse, data: T): Promise<void> {
    const body: ApiResponse<T> = {
      schemaVersion: APP_API_SCHEMA_VERSION,
      deployment: await source.deployment(),
      status: await status(),
      data,
    };
    write(res, 200, body);
  }

  function write(res: ServerResponse, code: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(code, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(text),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(text);
  }

  async function resolveSnapshot(scope: string[]): Promise<PublishedSnapshot> {
    const snapshots = await source.publications();
    if (scope[0] === "references") {
      const latest = snapshots.at(-1);
      if (!latest) throw new ApiError(404, "NO_ACCEPTED_REFERENCE", "no reference has been accepted yet");
      return latest;
    }
    const id = scope[1]!;
    if (!SNAPSHOT_PATTERN.test(id)) throw new ApiError(400, "INVALID_REQUEST", "invalid snapshot id");
    const found = snapshots.find((snapshot) => snapshot.identity.snapshotId === id);
    if (!found) throw new ApiError(404, "SNAPSHOT_NOT_FOUND", `snapshot ${id} not found`);
    return found;
  }

  async function referenceRoute(res: ServerResponse, segments: string[]): Promise<void> {
    const snapshot = await resolveSnapshot(segments);
    const rest = segments.slice(2);
    if (rest.length === 0) return send(res, toSnapshot(snapshot));
    if (rest[0] === "countries" && rest.length === 2) {
      const country = rest[1]!;
      if (!COUNTRY_PATTERN.test(country)) throw new ApiError(400, "INVALID_REQUEST", "country must be an ISO2 code");
      const entry = snapshot.countries.find((c) => c.country === country);
      if (!entry) throw new ApiError(404, "UNKNOWN_COUNTRY", `${country} is not in snapshot ${snapshot.identity.snapshotId}`);
      const body: CountryWorldReference = {
        snapshot: snapshot.identity,
        multiplier: snapshot.multiplier,
        country: entry,
        world: snapshot.world,
      };
      return send(res, body);
    }
    if (rest[0] === "pairs" && rest.length === 3) {
      const [base, quote] = [rest[1]!, rest[2]!];
      if (!COUNTRY_PATTERN.test(base) || !COUNTRY_PATTERN.test(quote)) {
        throw new ApiError(400, "INVALID_PAIR", "pair countries must be ISO2 codes");
      }
      const known = new Set(snapshot.countries.map((c) => c.country));
      const reference = base === quote || !known.has(base) || !known.has(quote) ? null : await source.pair(snapshot, base, quote);
      if (!reference) {
        throw new ApiError(400, "INVALID_PAIR", `${base}/${quote} is not a pair in snapshot ${snapshot.identity.snapshotId}`);
      }
      const body: PairReference = { snapshot: snapshot.identity, multiplier: snapshot.multiplier, base, quote, reference };
      return send(res, body);
    }
    throw new ApiError(404, "NOT_FOUND", "not found");
  }

  async function publications(url: URL, res: ServerResponse): Promise<void> {
    const after = parseSequence(url.searchParams.get("after"), "after");
    const limitText = url.searchParams.get("limit");
    const limit = limitText === null ? DEFAULT_PAGE : parseSequence(limitText, "limit");
    if (limit < 1 || limit > MAX_PAGE) throw new ApiError(400, "INVALID_REQUEST", `limit must be between 1 and ${MAX_PAGE}`);
    const events = (await source.publications())
      .filter((snapshot) => snapshot.identity.sequence > after)
      .slice(0, limit)
      .map(toEvent);
    const page: PublicationPage = { events, nextAfter: events.at(-1)?.sequence ?? after };
    return send(res, page);
  }

  async function stream(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    const header = req.headers["last-event-id"];
    const after = parseSequence(Array.isArray(header) ? header[0] : header ?? url.searchParams.get("after"), "last-event-id");
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    let last = after;
    const emit = (snapshot: PublishedSnapshot) => {
      if (snapshot.identity.sequence <= last) return;
      last = snapshot.identity.sequence;
      res.write(`id: ${last}\nevent: publication\ndata: ${JSON.stringify(toEvent(snapshot))}\n\n`);
    };
    const unsubscribe = source.onPublication(emit);
    for (const snapshot of await source.publications()) emit(snapshot);
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
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments[0] !== "v1") throw new ApiError(404, "NOT_FOUND", "not found");
    const path = segments.slice(1);
    if (path.length === 1 && path[0] === "deployment") return send(res, await source.deployment());
    if (path[0] === "references" && path[1] === "latest") return referenceRoute(res, path);
    if (path[0] === "snapshots" && path.length >= 2) return referenceRoute(res, path);
    if (path.length === 2 && path[0] === "proposals" && path[1] === "current") return send(res, await source.proposal());
    if (path.length === 2 && path[0] === "evidence" && path[1] === "readiness") return send(res, await source.readiness());
    if (path.length === 1 && path[0] === "publications") return publications(url, res);
    if (path.length === 2 && path[0] === "publications" && path[1] === "stream") return stream(req, url, res);
    throw new ApiError(404, "NOT_FOUND", "not found");
  }

  return createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (res.headersSent) return res.end();
      const body = (code: ErrorCode, message: string): ApiErrorBody => ({
        schemaVersion: APP_API_SCHEMA_VERSION,
        error: { code, message },
      });
      if (error instanceof ApiError) return write(res, error.status, body(error.code, error.message));
      if (error instanceof URIError) return write(res, 400, body("INVALID_REQUEST", "invalid path encoding"));
      options.onError?.(error);
      write(res, 500, body("INTERNAL_ERROR", "internal error"));
    });
  });
}
