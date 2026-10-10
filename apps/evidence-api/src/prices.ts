import { getAssets, type Asset, type CutoffRecord, type Incident, type VenueAttempt } from "@eox/evidence-store";

export const PRICE_SCHEMA = "cox.evidence/v1";
export const PRICE_RULE = "COX/PRICE-FALLBACK/V1";
const CUTOFF_PATTERN = /^[1-9][0-9]{0,11}$/;

export function parseCutoff(value: string): number | null {
  if (!CUTOFF_PATTERN.test(value)) return null;
  const cutoff = Number(value);
  return cutoff % 60 === 0 ? cutoff : null;
}

function attemptView(attempt: VenueAttempt) {
  return { step: attempt.step, venue: attempt.venue, outcome: attempt.outcome, artifactDigest: attempt.rawSha256 };
}

function incidentView(incident: Incident) {
  return {
    kind: incident.kind,
    assetId: incident.assetId,
    venue: incident.venue,
    detail: incident.detail,
    artifactDigest: incident.rawSha256,
    recordedAtMs: incident.recordedAt.getTime(),
  };
}

let assetCache: { at: number; assets: Asset[] } | null = null;

async function roster(): Promise<Asset[]> {
  if (!assetCache || Date.now() - assetCache.at > 60_000) assetCache = { at: Date.now(), assets: await getAssets() };
  return assetCache.assets;
}

export async function cutoffView(record: CutoffRecord) {
  const snapshot = record.snapshot!;
  const included = new Set(snapshot.observationIds);
  const assets = (await roster()).map((asset) => {
    const observation = record.observations.find((o) => o.assetId === asset.assetId) ?? null;
    return {
      assetId: asset.assetId,
      position: asset.position,
      attempts: record.attempts.filter((a) => a.assetId === asset.assetId).sort((a, b) => a.step - b.step).map(attemptView),
      price: observation && included.has(observation.id)
        ? {
            venue: observation.venue,
            step: observation.step,
            candleStart: observation.candleStart,
            close: observation.close,
            usdtUsd: observation.usdtUsd,
            usdtArtifactDigest: observation.usdtRawSha256,
            priceE8: observation.priceE8,
            tradeEvidence: observation.tradeEvidence,
            tradeAgeMinutes: observation.tradeAgeMinutes,
            artifactDigest: observation.rawSha256,
            admissible: observation.admissible,
            rejection: observation.rejection,
          }
        : null,
    };
  });
  return {
    schema: PRICE_SCHEMA,
    rule: PRICE_RULE,
    cutoff: record.cutoff,
    snapshot: {
      digest: snapshot.snapshotDigest,
      admissible: snapshot.admissible,
      recordedAtMs: snapshot.recordedAt.getTime(),
    },
    priceScale: "100000000",
    assets,
    usdtUsd: { attempts: record.attempts.filter((a) => a.assetId === "USDT").sort((a, b) => a.step - b.step).map(attemptView) },
    incidents: record.incidents.map(incidentView),
  };
}
