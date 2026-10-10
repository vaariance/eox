import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  getCutoff,
  getObservation,
  getReleaseBefore,
  getSourcePayload,
  getSourceRelease,
  readChanges,
  readSnapshotChanges,
  type ChangeCursor,
  type SourceRelease,
} from "@eox/evidence-store";
import { parsePortRecords } from "@eox/ingestion";
import { parseRecordId, PUBLICATION_POLICY, toEvidenceFact, toRecordId, type ReleaseEvidence } from "./facts.js";
import { cutoffView, parseCutoff, PRICE_SCHEMA } from "./prices.js";

const DEFAULT_PAGE_SIZE = 128;
const MAX_PAGE_SIZE = 500;
const CURSOR_PATTERN = /^([0-9]{1,20})\.([1-9][0-9]{0,18})$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function encodeCursor(cursor: ChangeCursor | null): string | null {
  return cursor ? `${cursor.xid}.${cursor.id}` : null;
}

function decodeCursor(value: string | null): ChangeCursor | null {
  if (value === null || value === "") return null;
  const match = CURSOR_PATTERN.exec(value);
  if (!match) throw new HttpError(400, "invalid cursor");
  return { xid: match[1]!, id: match[2]! };
}

function pageSize(value: string | null): number {
  if (value === null) return DEFAULT_PAGE_SIZE;
  if (!/^[0-9]{1,3}$/.test(value)) throw new HttpError(400, "invalid limit");
  const limit = Number(value);
  if (limit < 1 || limit > MAX_PAGE_SIZE) throw new HttpError(400, `limit must be between 1 and ${MAX_PAGE_SIZE}`);
  return limit;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(text);
}

async function changes(url: URL, res: ServerResponse): Promise<void> {
  const page = await readChanges(decodeCursor(url.searchParams.get("cursor")), pageSize(url.searchParams.get("limit")));
  const facts = page.observations.flatMap((observation) => {
    const fact = toEvidenceFact(observation);
    return fact ? [{ changeId: `eox:change:${observation.id}`, recordId: fact.recordId }] : [];
  });
  sendJson(res, 200, { cursor: encodeCursor(page.cursor), changes: facts });
}

async function evidenceFact(recordId: string) {
  const observationId = parseRecordId(recordId);
  if (observationId === null) throw new HttpError(400, "invalid record id");
  const observation = await getObservation(observationId);
  const fact = observation ? toEvidenceFact(observation) : null;
  if (!fact || fact.recordId !== toRecordId(observationId)) throw new HttpError(404, "record not found");
  if (observation!.releaseId !== null) {
    const release = await getSourceRelease(observation!.releaseId);
    const previous = release ? await getReleaseBefore(release.sourceId, release.dataset, release.releasedAt) : null;
    if (!release || !previous) throw new HttpError(500, "publication evidence is incomplete");
    fact.publishedAt = Math.floor(release.releasedAt.getTime() / 1000);
    fact.publication = {
      policy: PUBLICATION_POLICY,
      basis: "source-data-edit",
      release: releaseEvidence(release),
      previousRelease: releaseEvidence(previous),
    };
  }
  return fact;
}

function releaseEvidence(release: SourceRelease): ReleaseEvidence {
  return {
    releasedAtMs: release.releasedAt.getTime(),
    latestPeriod: release.latestPeriod,
    metadataDigest: release.metadataSha256,
    periodsDigest: release.periodsSha256,
  };
}

async function constituents(recordId: string, res: ServerResponse): Promise<void> {
  const fact = await evidenceFact(recordId);
  if (fact.indicator !== "container_throughput") throw new HttpError(404, "record has no constituents");
  const payload = await getSourcePayload(fact.artifactDigest);
  if (!payload) throw new HttpError(500, "stored artifact is missing");
  const ports = parsePortRecords(payload.body.toString("utf8"))
    .filter((port) => port.iso3 === fact.countryIso3 && port.date === fact.period)
    .map((port) => ({
      portId: port.portId,
      date: port.date,
      importContainer: port.importContainer,
      exportContainer: port.exportContainer,
      portCalls: port.portCalls,
      reported: port.importContainer !== null && port.exportContainer !== null,
    }));
  sendJson(res, 200, {
    recordId: fact.recordId,
    indicator: fact.indicator,
    country: fact.country,
    period: fact.period,
    artifactDigest: fact.artifactDigest,
    aggregation: "sum of import_container and export_container over ports that report both; values are the source's exact decimal text",
    coverage: fact.coverage,
    ports,
  });
}

async function record(recordId: string, res: ServerResponse): Promise<void> {
  sendJson(res, 200, await evidenceFact(recordId));
}

async function artifact(digest: string, res: ServerResponse): Promise<void> {
  if (!SHA256_PATTERN.test(digest)) throw new HttpError(400, "invalid artifact digest");
  const payload = await getSourcePayload(digest);
  if (!payload) throw new HttpError(404, "artifact not found");
  if (createHash("sha256").update(payload.body).digest("hex") !== digest) {
    throw new HttpError(500, "stored artifact does not match its digest");
  }
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": payload.body.length,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "x-source-content-type": payload.contentType ?? "",
    "x-content-sha256": digest,
  });
  res.end(payload.body);
}

async function priceCutoff(value: string, res: ServerResponse): Promise<void> {
  const cutoff = parseCutoff(value);
  if (cutoff === null) throw new HttpError(400, "cutoff must be Unix seconds on a minute boundary");
  const record = await getCutoff(cutoff);
  if (!record.snapshot) throw new HttpError(404, "cutoff not archived");
  sendJson(res, 200, await cutoffView(record));
}

async function priceChanges(url: URL, res: ServerResponse): Promise<void> {
  const page = await readSnapshotChanges(decodeCursor(url.searchParams.get("after")), pageSize(url.searchParams.get("limit")));
  sendJson(res, 200, {
    schema: PRICE_SCHEMA,
    after: encodeCursor(page.cursor),
    cutoffs: page.snapshots.map((s) => ({ cutoff: s.cutoff, admissible: s.admissible, snapshotDigest: s.snapshotDigest })),
  });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    throw new HttpError(405, "method not allowed");
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (url.pathname === "/health") return sendJson(res, 200, { status: "ok" });
  if (segments.length === 2 && segments[0] === "v1" && segments[1] === "changes") return changes(url, res);
  if (segments.length === 3 && segments[0] === "v1" && segments[1] === "records") return record(segments[2]!, res);
  if (segments.length === 4 && segments[0] === "v1" && segments[1] === "records" && segments[3] === "constituents") {
    return constituents(segments[2]!, res);
  }
  if (segments.length === 3 && segments[0] === "v1" && segments[1] === "artifacts") return artifact(segments[2]!, res);
  if (segments.length === 4 && segments[0] === "v1" && segments[1] === "prices" && segments[2] === "cutoffs") return priceCutoff(segments[3]!, res);
  if (segments.length === 3 && segments[0] === "v1" && segments[1] === "prices" && segments[2] === "changes") return priceChanges(url, res);
  throw new HttpError(404, "not found");
}

export function createEvidenceServer(onError: (error: unknown) => void = () => {}): Server {
  return createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      if (error instanceof URIError) return sendJson(res, 400, { error: "invalid path encoding" });
      onError(error);
      sendJson(res, 500, { error: "internal error" });
    });
  });
}
