import type {
  CountryReference,
  CountryState,
  Deployment,
  EvidenceReadiness,
  Proposal,
  Reference,
  SnapshotIdentity,
} from "@eox/app-api";

export interface PublishedSnapshot {
  identity: SnapshotIdentity;
  multiplier: number;
  world: CountryState;
  countries: CountryReference[];
  pairs: ReadonlyMap<string, Reference>;
}

export function pairKey(base: string, quote: string): string {
  return `${base}/${quote}`;
}

export interface ReferenceSource {
  deployment(): Promise<Deployment>;
  publications(): Promise<readonly PublishedSnapshot[]>;
  proposal(): Promise<Proposal | null>;
  readiness(): Promise<EvidenceReadiness>;
  onPublication(listener: (snapshot: PublishedSnapshot) => void): () => void;
}
