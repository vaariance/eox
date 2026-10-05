import { createHash } from "node:crypto";

export interface FetchedPayload {
  requestUrl: string;
  httpStatus: number;
  contentType: string | null;
  body: Uint8Array;
  sha256: string;
}

export async function capturePayload(requestUrl: string, res: Response): Promise<FetchedPayload> {
  const body = new Uint8Array(await res.arrayBuffer());
  return {
    requestUrl,
    httpStatus: res.status,
    contentType: res.headers.get("content-type"),
    body,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

export function payloadText(payload: FetchedPayload): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(payload.body);
}
