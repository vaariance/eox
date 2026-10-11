import type { CoxAsset, CoxDeployment, CoxStatus, CryptoComposition, Portfolio, Publication } from "@eox/app-api";

export interface CoxSource {
  deployment(): Promise<CoxDeployment>;
  status(now: number): Promise<CoxStatus>;
  assets(now: number): Promise<CoxAsset[]>;
  crypto(): Promise<CryptoComposition>;
  publications(now: number): Promise<readonly Publication[]>;
  portfolio(owner: string): Promise<Portfolio | null>;
  onPublication(listener: (publication: Publication) => void): () => void;
}
