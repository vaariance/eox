import { getLatest, recordObservation, type NewObservation } from "@eox/evidence-store";

interface KnownValue {
  value: string;
  knownAt: number;
}

function periodKey(observation: { periodStart: string; periodEnd: string }): string {
  return `${observation.periodStart}/${observation.periodEnd}`;
}

function knownAtMillis(observation: NewObservation): number {
  return observation.knownAt ? Date.parse(observation.knownAt) : Number.MAX_SAFE_INTEGER;
}

async function loadKnownValues(sample: NewObservation): Promise<Map<string, KnownValue>> {
  const latest = await getLatest({
    countryIso3: sample.countryIso3,
    indicatorId: sample.indicatorId,
    sourceId: sample.sourceId,
  });
  return new Map(
    latest.map((observation) => [
      periodKey(observation),
      { value: observation.value, knownAt: new Date(observation.knownAt).getTime() },
    ]),
  );
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
    const known = await loadKnownValues(group[0]);
    const ordered = [...group].sort((a, b) => knownAtMillis(a) - knownAtMillis(b));
    for (const observation of ordered) {
      const key = periodKey(observation);
      const existing = known.get(key);
      const value = String(observation.value);
      const knownAt = knownAtMillis(observation);
      if (existing && (existing.value === value || existing.knownAt >= knownAt)) continue;
      await recordObservation(observation);
      known.set(key, { value, knownAt });
      recorded++;
    }
  }
  return recorded;
}
