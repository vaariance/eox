import { createHash } from "node:crypto";
import type { ArchivedCutoff } from "./archive.js";

export interface EvidenceSource {
  hasArtifact(sha256: string): Promise<boolean>;
  cutoff(cutoff: number): Promise<ArchivedCutoff | null>;
}

export class EvidenceUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceUnavailable";
  }
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PRICE_SCHEMA = "cox.evidence/v1";

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
    async cutoff(cutoff) {
      if (!Number.isSafeInteger(cutoff) || cutoff <= 0 || cutoff % 60 !== 0) throw new EvidenceUnavailable(`invalid cutoff ${cutoff}`);
      const response = await get(`/v1/prices/cutoffs/${cutoff}`);
      if (!response) return null;
      const body = (await response.json()) as Partial<ArchivedCutoff> & { schema?: string };
      if (body.schema !== PRICE_SCHEMA || body.cutoff !== cutoff || !body.snapshot || !Array.isArray(body.assets) || !body.usdtUsd) {
        throw new EvidenceUnavailable(`evidence API returned a malformed snapshot for cutoff ${cutoff}`);
      }
      return { cutoff, snapshot: body.snapshot, assets: body.assets, usdtUsd: body.usdtUsd };
    },
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
