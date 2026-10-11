import type { CoxApiErrorBody, CoxApiResponse, CoxAsset, CoxDeployment, CoxPublicationPage, CoxStatus, CryptoComposition, Portfolio, Publication } from "@eox/app-api";
import * as sample from "./sample";

const SCHEMA_VERSION = "cox.app-api/v1";
const HISTORY = 240;
const PAGE = 100;
const MAX_PAGES = 50;

const baseUrl = process.env.COX_API_URL?.replace(/\/+$/, "");
const demoWallet = process.env.COX_DEMO_WALLET;

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}/v1/${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
  const body = (await response.json()) as CoxApiResponse<T> | CoxApiErrorBody;
  if (body.schemaVersion !== SCHEMA_VERSION) throw new ApiError("INTERNAL_ERROR", `unsupported schema version ${String(body.schemaVersion)}`);
  if ("error" in body) throw new ApiError(body.error.code, body.error.message);
  return body.data;
}

export async function getDeployment(): Promise<CoxDeployment> {
  return baseUrl ? get<CoxDeployment>("deployment") : sample.deployment;
}

export async function getStatus(): Promise<CoxStatus> {
  return baseUrl ? get<CoxStatus>("status") : sample.status;
}

export async function getAssets(): Promise<CoxAsset[]> {
  return baseUrl ? get<CoxAsset[]>("assets") : sample.assets;
}

export async function getCrypto(): Promise<CryptoComposition> {
  return baseUrl ? get<CryptoComposition>("crypto") : sample.composition;
}

export async function getPublications(): Promise<Publication[]> {
  if (!baseUrl) return sample.publications;
  const publications: Publication[] = [];
  let after: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: CoxPublicationPage = await get<CoxPublicationPage>(after === null ? `publications?limit=${PAGE}` : `publications?after=${after}&limit=${PAGE}`);
    publications.push(...data.events.map((event) => event.publication));
    if (data.events.length < PAGE || data.nextAfter === null) break;
    after = data.nextAfter;
  }
  return publications.slice(-HISTORY);
}

export async function getPortfolio(): Promise<Portfolio | null> {
  if (!baseUrl) return sample.portfolio;
  if (!demoWallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(demoWallet)) return null;
  try {
    return await get<Portfolio>(`wallets/${demoWallet}/portfolio`);
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNKNOWN_WALLET") return null;
    throw error;
  }
}
