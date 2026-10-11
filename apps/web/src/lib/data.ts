import { DEFAULT_API_URL, FIXTURE_DEMO_WALLET } from "./config";
import { type CoxAsset, type CoxDeployment, type CoxStatus, type CryptoComposition, type Portfolio, type Publication, CoxApiError, createCoxApiClient } from "@eox/app-api";

const HISTORY = 240;
const PAGE = 100;
const MAX_PAGES = 50;
const OWNER = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const configuredWallet = process.env.COX_DEMO_WALLET;
export const api = createCoxApiClient({
  baseUrl: process.env.COX_API_URL ?? DEFAULT_API_URL,
  fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
});

export async function getDeployment(): Promise<CoxDeployment> {
  return (await api.deployment()).data;
}

export async function getStatus(): Promise<CoxStatus> {
  return (await api.status()).data;
}

export async function getAssets(): Promise<CoxAsset[]> {
  return (await api.assets()).data;
}

export async function getCrypto(): Promise<CryptoComposition> {
  return (await api.crypto()).data;
}

export async function getPublications(): Promise<Publication[]> {
  const publications: Publication[] = [];
  let after: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = await api.publications(after, PAGE);
    publications.push(...data.events.map((event) => event.publication));
    if (data.events.length < PAGE || data.nextAfter === null) break;
    after = data.nextAfter;
  }
  return publications.slice(-HISTORY);
}

export async function getDemoPortfolio(): Promise<Portfolio | null> {
  if ((await getDeployment()).origin !== "fixture") return null;
  const demoWallet = configuredWallet ?? FIXTURE_DEMO_WALLET;
  if (!OWNER.test(demoWallet)) return null;
  try {
    return (await api.portfolio(demoWallet)).data;
  } catch (error) {
    if (error instanceof CoxApiError && error.code === "UNKNOWN_WALLET") return null;
    throw error;
  }
}
