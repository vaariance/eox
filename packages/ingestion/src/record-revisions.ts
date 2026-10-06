import { getVersions, recordObservation, type NewObservation, type Observation } from "@eox/evidence-store";

interface StoredVersion {
  knownAt: number;
  value: string;
  hasPayload: boolean;
  coverageReported: number | null;
  coverageTotal: number | null;
}

function periodKey(observation: { periodStart: string; periodEnd: string }): string {
  return `${observation.periodStart}/${observation.periodEnd}`;
}

function toStoredVersion(observation: Observation): StoredVersion {
  return {
    knownAt: new Date(observation.knownAt).getTime(),
    value: observation.value,
    hasPayload: observation.rawSha256 !== null,
    coverageReported: observation.coverageReported,
    coverageTotal: observation.coverageTotal,
  };
}

function toIncomingVersion(observation: NewObservation, knownAt: number): StoredVersion {
  return {
    knownAt,
    value: String(observation.value),
    hasPayload: Boolean(observation.rawSha256),
    coverageReported: observation.coverageReported ?? null,
    coverageTotal: observation.coverageTotal ?? null,
  };
}

function carriesSameEvidence(stored: StoredVersion, incoming: StoredVersion, vintaged: boolean): boolean {
  return (
    stored.value === incoming.value &&
    stored.coverageReported === incoming.coverageReported &&
    stored.coverageTotal === incoming.coverageTotal &&
    (vintaged || stored.hasPayload || !incoming.hasPayload)
  );
}

function insertSorted(versions: StoredVersion[], version: StoredVersion): void {
  const index = versions.findIndex((existing) => existing.knownAt > version.knownAt);
  if (index === -1) versions.push(version);
  else versions.splice(index, 0, version);
}

async function loadVersions(sample: NewObservation): Promise<Map<string, StoredVersion[]>> {
  const stored = await getVersions({
    countryIso3: sample.countryIso3,
    indicatorId: sample.indicatorId,
    sourceId: sample.sourceId,
  });
  const byPeriod = new Map<string, StoredVersion[]>();
  for (const observation of stored) {
    const key = periodKey(observation);
    const versions = byPeriod.get(key);
    if (versions) versions.push(toStoredVersion(observation));
    else byPeriod.set(key, [toStoredVersion(observation)]);
  }
  for (const versions of byPeriod.values()) versions.sort((a, b) => a.knownAt - b.knownAt);
  return byPeriod;
}

function isRedundant(versions: readonly StoredVersion[], incoming: StoredVersion, vintaged: boolean): boolean {
  if (vintaged && versions.some((version) => version.knownAt === incoming.knownAt)) return true;
  const predecessor = vintaged
    ? versions.filter((version) => version.knownAt < incoming.knownAt).at(-1)
    : versions.at(-1);
  return predecessor !== undefined && carriesSameEvidence(predecessor, incoming, vintaged);
}

export async function recordRevisions(observations: readonly NewObservation[]): Promise<number> {
  const groups = new Map<string, NewObservation[]>();
  for (const observation of observations) {
    const key = `${observation.countryIso3}|${observation.indicatorId}|${observation.sourceId}`;
    const group = groups.get(key);
    if (group) group.push(observation);
    else groups.set(key, [observation]);
  }

  let recorded = 0;
  for (const group of groups.values()) {
    const byPeriod = await loadVersions(group[0]);
    const ordered = [...group].sort(
      (a, b) => (a.knownAt ? Date.parse(a.knownAt) : Infinity) - (b.knownAt ? Date.parse(b.knownAt) : Infinity) || 0,
    );
    for (const observation of ordered) {
      const key = periodKey(observation);
      const versions = byPeriod.get(key) ?? [];
      const vintaged = observation.knownAt !== undefined;
      const incoming = toIncomingVersion(observation, vintaged ? Date.parse(observation.knownAt as string) : Date.now());
      if (isRedundant(versions, incoming, vintaged)) continue;
      const stored = await recordObservation(observation);
      insertSorted(versions, toStoredVersion(stored));
      byPeriod.set(key, versions);
      recorded++;
    }
  }
  return recorded;
}
