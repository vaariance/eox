import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { ArchiveMonitor, Verdict } from "./monitor.js";

export const MONITOR_SCHEMA = "cox.monitor/v1";
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 1440;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function failure(response: ServerResponse, status: number, code: string, message: string): void {
  send(response, status, { schema: MONITOR_SCHEMA, error: { code, message } });
}

function view(verdict: Verdict) {
  return { scope: "archive", ...verdict };
}

function handle(monitor: ArchiveMonitor, request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== "GET") return failure(response, 405, "METHOD_NOT_ALLOWED", "this service is read-only");
  const url = new URL(request.url ?? "/", "http://monitor");
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments.length === 1 && (segments[0] === "health" || segments[0] === "healthz")) {
    const { checked, mismatches, cursor } = monitor.state;
    return send(response, 200, { schema: MONITOR_SCHEMA, checked, mismatches, started: cursor !== null, latestCutoff: monitor.latest()?.cutoff ?? null });
  }
  if (segments[0] !== "v1" || segments[1] !== "verdicts") return failure(response, 404, "NOT_FOUND", "no such route");

  if (segments.length === 2) {
    const text = url.searchParams.get("limit");
    const limit = text === null ? DEFAULT_LIMIT : Number(text);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return failure(response, 400, "INVALID_REQUEST", `limit must be between 1 and ${MAX_LIMIT}`);
    return send(response, 200, { schema: MONITOR_SCHEMA, verdicts: monitor.recent(limit).map(view) });
  }
  if (segments.length === 3 && segments[2] === "latest") {
    const latest = monitor.latest();
    if (!latest) return failure(response, 404, "NO_VERDICT", "nothing has been checked yet");
    return send(response, 200, { schema: MONITOR_SCHEMA, verdict: view(latest) });
  }
  if (segments.length === 3 && /^[1-9][0-9]{0,11}$/.test(segments[2]!)) {
    const found = monitor.find(Number(segments[2]));
    if (!found) return failure(response, 404, "VERDICT_NOT_FOUND", "no verdict is held for that cutoff");
    return send(response, 200, { schema: MONITOR_SCHEMA, verdict: view(found) });
  }
  return failure(response, 404, "NOT_FOUND", "no such route");
}

export function createMonitorServer(monitor: ArchiveMonitor): Server {
  return createServer((request, response) => {
    try {
      handle(monitor, request, response);
    } catch {
      failure(response, 500, "INTERNAL_ERROR", "the monitor could not answer");
    }
  });
}
