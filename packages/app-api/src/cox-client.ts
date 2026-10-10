import type {
  CoxApiErrorBody,
  CoxApiResponse,
  CoxAsset,
  CoxDeployment,
  CoxErrorCode,
  CoxPublicationEvent,
  CoxPublicationPage,
  CoxStatus,
  CryptoComposition,
  Portfolio,
  Publication,
} from "./cox-types.js";
import { COX_APP_API_SCHEMA_VERSION } from "./cox-types.js";

export class CoxApiError extends Error {
  constructor(
    readonly code: CoxErrorCode,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "CoxApiError";
  }
}

export interface CoxApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface CoxPublicationSubscription {
  close(): void;
  closed: Promise<void>;
}

const ASSET_PATTERN = /^[A-Z0-9]{2,12}$/;
const OWNER_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function checkSequence(value: number | null, name: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new CoxApiError("INVALID_REQUEST", `invalid ${name}`, 0);
}

export function createCoxApiClient(options: CoxApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;

  async function get<T>(path: string): Promise<CoxApiResponse<T>> {
    const res = await doFetch(`${baseUrl}/v1/${path}`, { headers: { accept: "application/json" } });
    const body = (await res.json()) as CoxApiResponse<T> | CoxApiErrorBody;
    if (body.schemaVersion !== COX_APP_API_SCHEMA_VERSION) {
      throw new CoxApiError("INTERNAL_ERROR", `unsupported schema version ${String(body.schemaVersion)}`, res.status);
    }
    if ("error" in body) throw new CoxApiError(body.error.code, body.error.message, res.status);
    return body;
  }

  return {
    deployment: () => get<CoxDeployment>("deployment"),
    status: () => get<CoxStatus>("status"),
    assets: () => get<CoxAsset[]>("assets"),
    crypto: () => get<CryptoComposition>("crypto"),
    latestPublication: () => get<Publication>("publications/latest"),
    publication: (sequence: number) => {
      checkSequence(sequence, "sequence");
      return get<Publication>(`publications/${sequence}`);
    },
    publications: (after: number | null = null, limit = 100) => {
      checkSequence(after, "after");
      if (!Number.isSafeInteger(limit) || limit < 1) throw new CoxApiError("INVALID_REQUEST", "invalid limit", 0);
      return get<CoxPublicationPage>(after === null ? `publications?limit=${limit}` : `publications?after=${after}&limit=${limit}`);
    },
    portfolio: (owner: string) => {
      if (!OWNER_PATTERN.test(owner)) throw new CoxApiError("INVALID_REQUEST", "invalid owner", 0);
      return get<Portfolio>(`wallets/${owner}/portfolio`);
    },
    asset: (assetId: string) => {
      if (!ASSET_PATTERN.test(assetId)) throw new CoxApiError("INVALID_REQUEST", "invalid asset", 0);
      return get<CoxAsset>(`assets/${assetId}`);
    },
    subscribePublications(after: number | null, onEvent: (event: CoxPublicationEvent) => void): CoxPublicationSubscription {
      checkSequence(after, "after");
      const controller = new AbortController();
      let lastSequence = after;
      const closed = (async () => {
        const res = await doFetch(`${baseUrl}/v1/publications/stream`, {
          headers: lastSequence === null ? { accept: "text/event-stream" } : { accept: "text/event-stream", "last-event-id": String(lastSequence) },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new CoxApiError("INTERNAL_ERROR", `stream failed with ${res.status}`, res.status);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const data = buffer
              .slice(0, boundary)
              .split("\n")
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6))
              .join("\n");
            buffer = buffer.slice(boundary + 2);
            if (data) {
              const event = JSON.parse(data) as CoxPublicationEvent;
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

export type CoxApiClient = ReturnType<typeof createCoxApiClient>;
