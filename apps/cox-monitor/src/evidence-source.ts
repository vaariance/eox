import { createHash } from "node:crypto";

export interface EvidenceSource {
  hasArtifact(sha256: string): Promise<boolean>;
}

export class EvidenceUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceUnavailable";
  }
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function httpEvidenceSource(baseUrl: string, doFetch: typeof fetch = fetch): EvidenceSource {
  const base = baseUrl.replace(/\/+$/, "");

  async function get(path: string): Promise<Response | null> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`);
    } catch (error) {
      throw new EvidenceUnavailable(error instanceof Error ? error.message : String(error));
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new EvidenceUnavailable(`evidence API answered HTTP ${response.status} for ${path}`);
    return response;
  }

  return {
    async hasArtifact(sha256) {
      if (!DIGEST_PATTERN.test(sha256)) throw new EvidenceUnavailable(`invalid artifact digest ${sha256}`);
      const response = await get(`/v1/artifacts/${sha256}`);
      if (!response) return false;
      const body = Buffer.from(await response.arrayBuffer());
      if (createHash("sha256").update(body).digest("hex") !== sha256) {
        throw new EvidenceUnavailable(`evidence API returned bytes that do not hash to ${sha256}`);
      }
      return true;
    },
  };
}
