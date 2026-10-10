import type {
  ApiErrorBody,
  ApiResponse,
  CountryWorldReference,
  Deployment,
  ErrorCode,
  EvidenceReadiness,
  PairReference,
  Proposal,
  PublicationEvent,
  PublicationPage,
  ReferenceSnapshot,
} from "./types.js";
import { APP_API_SCHEMA_VERSION } from "./types.js";

export class AppApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "AppApiError";
  }
}

export interface AppApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface PublicationSubscription {
  close(): void;
  closed: Promise<void>;
}

const SEGMENT_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/;

function segment(value: string, name: string): string {
  if (!SEGMENT_PATTERN.test(value)) throw new AppApiError("INVALID_REQUEST", `invalid ${name}`, 0);
  return encodeURIComponent(value);
}

function scope(snapshotId: string | undefined): string {
  return snapshotId === undefined ? "references/latest" : `snapshots/${segment(snapshotId, "snapshot id")}`;
}

export function createAppApiClient(options: AppApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;

  async function get<T>(path: string): Promise<ApiResponse<T>> {
    const res = await doFetch(`${baseUrl}/v1/${path}`, { headers: { accept: "application/json" } });
    const body = (await res.json()) as ApiResponse<T> | ApiErrorBody;
    if (body.schemaVersion !== APP_API_SCHEMA_VERSION) {
      throw new AppApiError("INTERNAL_ERROR", `unsupported schema version ${String(body.schemaVersion)}`, res.status);
    }
    if ("error" in body) throw new AppApiError(body.error.code, body.error.message, res.status);
    return body;
  }

  return {
    deployment: () => get<Deployment>("deployment"),
    latestReference: () => get<ReferenceSnapshot>("references/latest"),
    snapshot: (snapshotId: string) => get<ReferenceSnapshot>(`snapshots/${segment(snapshotId, "snapshot id")}`),
    countryReference: (country: string, snapshotId?: string) =>
      get<CountryWorldReference>(`${scope(snapshotId)}/countries/${segment(country, "country")}`),
    pair: (base: string, quote: string, snapshotId?: string) =>
      get<PairReference>(`${scope(snapshotId)}/pairs/${segment(base, "base")}/${segment(quote, "quote")}`),
    proposal: () => get<Proposal | null>("proposals/current"),
    evidenceReadiness: () => get<EvidenceReadiness>("evidence/readiness"),
    publications: (after: number | null = null, limit = 100) => {
      if (after !== null && (!Number.isSafeInteger(after) || after < 0)) throw new AppApiError("INVALID_REQUEST", "invalid after", 0);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new AppApiError("INVALID_REQUEST", "invalid limit", 0);
      return get<PublicationPage>(after === null ? `publications?limit=${limit}` : `publications?after=${after}&limit=${limit}`);
    },
    subscribePublications(after: number | null, onEvent: (event: PublicationEvent) => void): PublicationSubscription {
      if (after !== null && (!Number.isSafeInteger(after) || after < 0)) throw new AppApiError("INVALID_REQUEST", "invalid after", 0);
      const controller = new AbortController();
      let lastSequence = after;
      const closed = (async () => {
        const res = await doFetch(`${baseUrl}/v1/publications/stream`, {
          headers: lastSequence === null ? { accept: "text/event-stream" } : { accept: "text/event-stream", "last-event-id": String(lastSequence) },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new AppApiError("INTERNAL_ERROR", `stream failed with ${res.status}`, res.status);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6))
              .join("\n");
            if (data) {
              const event = JSON.parse(data) as PublicationEvent;
              if (lastSequence === null || event.sequence > lastSequence) {
                lastSequence = event.sequence;
                onEvent(event);
              }
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      })().catch((error: unknown) => {
        if (controller.signal.aborted) return;
        throw error;
      });
      return { close: () => controller.abort(), closed };
    },
  };
}

export type AppApiClient = ReturnType<typeof createAppApiClient>;
