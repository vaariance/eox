import {
  getCutoff,
  recordAssetResolution,
  recordIncident,
  recordSnapshot,
  recordSourcePayload,
  recordVenueResponse,
  type IncidentKind,
  type NewVenueAttempt,
  type Snapshot,
} from "@eox/evidence-store";
import {
  ARCHIVE_DEADLINE_SECONDS,
  resolveCutoffPrice,
  resolveUsdtUsd,
  type Attempt,
  type Evidence,
  type ResolverDeps,
  type RosterAsset,
  type UsdtResolution,
} from "@eox/price-feeds";
import { snapshotDigest, type DigestedPrice } from "./digest.js";

export interface ArchiveResult {
  cutoff: number;
  snapshot: Snapshot;
  resolved: number;
  admissible: boolean;
  late: boolean;
}

const OUTCOME_INCIDENT: Partial<Record<Attempt["outcome"], IncidentKind>> = {
  unavailable: "venue_unavailable",
  "rate-limited": "venue_rate_limited",
  malformed: "venue_malformed",
};

async function store(evidence: Evidence | null, assetId: string, cutoff: number): Promise<string | null> {
  if (!evidence) return null;
  const payload = await recordSourcePayload({
    sourceId: evidence.venue,
    requestUrl: evidence.request,
    httpStatus: evidence.request.startsWith("WS ") ? 101 : 200,
    contentType: evidence.contentType,
    body: evidence.body,
  });
  await recordVenueResponse({ venue: evidence.venue, assetId, cutoff, request: evidence.request, rawSha256: payload.sha256 });
  return payload.sha256;
}

async function storeAttempts(assetId: string, cutoff: number, attempts: Attempt[]): Promise<NewVenueAttempt[]> {
  const stored: NewVenueAttempt[] = [];
  for (const a of attempts) {
    const rawSha256 = await store(a.evidence, assetId, cutoff);
    stored.push({ venue: a.venue, step: a.step, outcome: a.outcome, rawSha256 });
    const kind = OUTCOME_INCIDENT[a.outcome];
    if (kind && !(a.outcome === "unavailable" && a.detail?.includes("disabled by configuration"))) {
      await recordIncident({ cutoff, kind, assetId, venue: a.venue, detail: a.detail ?? a.outcome, rawSha256 });
    }
  }
  return stored;
}

export async function archiveCutoff(
  deps: ResolverDeps,
  roster: readonly RosterAsset[],
  cutoff: number,
  now: () => number = Date.now,
): Promise<ArchiveResult> {
  const existing = await getCutoff(cutoff);
  if (existing.snapshot) throw new Error(`cutoff ${cutoff} is already archived`);
  let usdt: Promise<UsdtResolution> | null = null;
  const usdtOnce = () => (usdt ??= resolveUsdtUsd(deps, cutoff));
  const observationIds: string[] = [];
  const digested: DigestedPrice[] = [];
  let resolved = 0;
  let admissible = true;

  for (const asset of [...roster].sort((a, b) => a.position - b.position)) {
    const resolution = await resolveCutoffPrice(deps, asset, cutoff, usdtOnce);
    const attempts = await storeAttempts(asset.assetId, cutoff, resolution.attempts);
    const price = resolution.price;
    if (!price) {
      await recordAssetResolution({ assetId: asset.assetId, cutoff, attempts, observation: null });
      await recordIncident({ cutoff, kind: "asset_unresolved", assetId: asset.assetId, venue: null, detail: "no venue produced a price", rawSha256: null });
      admissible = false;
      continue;
    }
    const rawSha256 = (await store(price.evidence, asset.assetId, cutoff))!;
    const usdtRawSha256 = await store(price.usdtEvidence, "USDT", cutoff);
    const { observation } = await recordAssetResolution({
      assetId: asset.assetId,
      cutoff,
      attempts,
      observation: {
        venue: price.venue,
        step: price.step,
        candleStart: price.candleStart,
        close: price.close,
        usdtUsd: price.usdtUsd,
        usdtRawSha256,
        priceE8: price.priceE8,
        tradeEvidence: price.tradeEvidence,
        tradeAgeMinutes: price.tradeAgeMinutes,
        rawSha256,
        rejection: price.rejection,
      },
    });
    observationIds.push(observation!.id);
    resolved += 1;
    if (price.priceE8 !== null && price.rejection === null) {
      digested.push({ assetId: asset.assetId, venue: price.venue, step: price.step, candleStart: price.candleStart, priceE8: price.priceE8, tradeAgeMinutes: price.tradeAgeMinutes });
    }
    if (price.rejection) {
      admissible = false;
      await recordIncident({ cutoff, kind: "asset_inadmissible", assetId: asset.assetId, venue: price.venue, detail: price.rejection, rawSha256 });
    }
  }

  const pendingUsdt = usdt as Promise<UsdtResolution> | null;
  if (pendingUsdt) {
    const conversion = await pendingUsdt;
    await recordAssetResolution({ assetId: "USDT", cutoff, attempts: await storeAttempts("USDT", cutoff, conversion.attempts), observation: null });
  }

  const late = now() > (cutoff + ARCHIVE_DEADLINE_SECONDS) * 1000;
  if (late) {
    admissible = false;
    await recordIncident({ cutoff, kind: "archive_late", assetId: null, venue: null, detail: `archived ${Math.round(now() / 1000 - cutoff)} s after the cutoff`, rawSha256: null });
  }
  if (!admissible) {
    await recordIncident({ cutoff, kind: "snapshot_inadmissible", assetId: null, venue: null, detail: `${digested.length} of ${roster.length} assets admissible`, rawSha256: null });
  }
  const digest = admissible && digested.length === roster.length ? snapshotDigest(cutoff, digested) : null;
  const snapshot = await recordSnapshot({ cutoff, observationIds, snapshotDigest: digest, admissible: digest !== null });
  return { cutoff, snapshot, resolved, admissible: digest !== null, late };
}
