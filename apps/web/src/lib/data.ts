import type { CoxAsset, CoxDeployment, CoxStatus, CryptoComposition, Portfolio, Publication } from "@eox/app-api";
import * as sample from "./sample";

export async function getDeployment(): Promise<CoxDeployment> {
  return sample.deployment;
}

export async function getStatus(): Promise<CoxStatus> {
  return sample.status;
}

export async function getAssets(): Promise<CoxAsset[]> {
  return sample.assets;
}

export async function getCrypto(): Promise<CryptoComposition> {
  return sample.composition;
}

export async function getPublications(): Promise<Publication[]> {
  return sample.publications;
}

export async function getPortfolio(): Promise<Portfolio> {
  return sample.portfolio;
}
