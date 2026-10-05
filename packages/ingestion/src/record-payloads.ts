import { recordSourcePayload } from "@eox/evidence-store";
import type { FetchedPayload } from "./sources/payload.js";

export async function recordPayloads(sourceId: string, payloads: readonly FetchedPayload[]): Promise<void> {
  for (const payload of payloads) {
    const stored = await recordSourcePayload({
      sourceId,
      requestUrl: payload.requestUrl,
      httpStatus: payload.httpStatus,
      contentType: payload.contentType,
      body: payload.body,
    });
    if (stored.sha256 !== payload.sha256) {
      throw new Error(`payload hash mismatch for ${payload.requestUrl}: ${stored.sha256} != ${payload.sha256}`);
    }
  }
}
