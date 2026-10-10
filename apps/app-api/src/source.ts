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
}

export function pairKey(base: string, quote: string): string {
  return `${base}/${quote}`;
}

export interface ReferenceSource {
  deployment(): Promise<Deployment>;
  publications(): Promise<readonly PublishedSnapshot[]>;
  pair(snapshot: PublishedSnapshot, base: string, quote: string): Promise<Reference | null>;
  paused(): Promise<boolean>;
  proposal(): Promise<Proposal | null>;
  readiness(): Promise<EvidenceReadiness>;
  onPublication(listener: (snapshot: PublishedSnapshot) => void): () => void;
}
