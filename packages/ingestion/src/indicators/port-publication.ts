import type { SourceRelease } from "@eox/evidence-store";

export interface Publication {
  publishedAt: string;
  releaseId: string;
}

export function publicationFor(
  date: string,
  requested: boolean,
  release: SourceRelease | null,
  previous: SourceRelease | null,
): Publication | null {
  if (requested || !release || !previous) return null;
  if (!(previous.latestPeriod < date && date <= release.latestPeriod)) return null;
  return { publishedAt: release.releasedAt.toISOString(), releaseId: release.id };
}
