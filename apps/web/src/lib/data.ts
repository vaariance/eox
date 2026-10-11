import { DEFAULT_API_URL, FIXTURE_DEMO_WALLET } from "./config";
import { type CoxAsset, type CoxDeployment, type CoxStatus, type CryptoComposition, type Portfolio, type Publication, CoxApiError, createCoxApiClient } from "@eox/app-api";

const HISTORY = 1440;
const PAGE = 100;
const MAX_PAGES = 20;
const OWNER = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const configuredWallet = process.env.COX_DEMO_WALLET;
export const API_URL = (process.env.COX_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
export const api = createCoxApiClient({
  baseUrl: API_URL,
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

interface History {
  pool: string | null;
  publications: Publication[];
}

let history: History = { pool: null, publications: [] };
let loading: Promise<Publication[]> | null = null;

async function loadPublications(): Promise<Publication[]> {
  const { deployment, data: status } = await api.status();
  const pool = deployment.poolAddress ?? deployment.network;
  const latest = status.latestSequence;
  const held = history.pool === pool ? history.publications : [];
  if (latest === null) {
    history = { pool, publications: [] };
    return [];
  }
  const last = held.length > 0 ? held[held.length - 1].identity.sequence : null;
  const known = last !== null && last <= latest ? held : [];
  const floor = latest - HISTORY;
  let after: number | null = known.length > 0 ? known[known.length - 1].identity.sequence : floor >= 0 ? floor : null;
  const publications = [...known];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = await api.publications(after, PAGE);
    publications.push(...data.events.map((event) => event.publication));
    if (data.events.length < PAGE || data.nextAfter === null) break;
    after = data.nextAfter;
  }
  history = { pool, publications: publications.slice(-HISTORY) };
  return history.publications;
}

export async function getPublications(): Promise<Publication[]> {
  loading ??= loadPublications().finally(() => {
    loading = null;
  });
  return loading;
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
