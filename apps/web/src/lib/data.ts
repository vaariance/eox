import { DEFAULT_API_URL, FIXTURE_DEMO_WALLET } from "./config";
import { type CoxAsset, type CoxDeployment, type CoxStatus, type CryptoComposition, type Portfolio, type Publication, CoxApiError, createCoxApiClient } from "@eox/app-api";

const HISTORY = 240;
const PAGE = 100;
const MAX_PAGES = 50;
const OWNER = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const configuredWallet = process.env.COX_DEMO_WALLET;
const client = createCoxApiClient({
  baseUrl: process.env.COX_API_URL ?? DEFAULT_API_URL,
  fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
});

export async function getDeployment(): Promise<CoxDeployment> {
  return (await client.deployment()).data;
}

export async function getStatus(): Promise<CoxStatus> {
  return (await client.status()).data;
}

export async function getAssets(): Promise<CoxAsset[]> {
  return (await client.assets()).data;
}

export async function getCrypto(): Promise<CryptoComposition> {
  return (await client.crypto()).data;
}

export async function getPublications(): Promise<Publication[]> {
  const publications: Publication[] = [];
  let after: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = await client.publications(after, PAGE);
    publications.push(...data.events.map((event) => event.publication));
    if (data.events.length < PAGE || data.nextAfter === null) break;
    after = data.nextAfter;
  }
  return publications.slice(-HISTORY);
}

export async function getPortfolio(): Promise<Portfolio | null> {
  const demoWallet = configuredWallet ?? ((await getDeployment()).origin === "fixture" ? FIXTURE_DEMO_WALLET : undefined);
  if (!demoWallet || !OWNER.test(demoWallet)) return null;
  try {
    return (await client.portfolio(demoWallet)).data;
  } catch (error) {
    if (error instanceof CoxApiError && error.code === "UNKNOWN_WALLET") return null;
    throw error;
  }
}
