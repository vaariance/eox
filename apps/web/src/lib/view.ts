import type { ClassValuation, CoxDeployment, CoxStatus, PriceVenue, Publication, PublishedPrice } from "@eox/app-api";

export const PRICE_DIGITS = 8;
export const SCALE_DIGITS = 12;
export const CRYPTO_CLASS = "CRYPTO";
export const SAMPLE_SOURCE = "apps/web sample data";
const DEFAULT_DECIMALS = 0;
const BATCH_SECONDS = 60;

export function decimalsOf(deployment: CoxDeployment): number {
  return deployment.collateralDecimals ?? DEFAULT_DECIMALS;
}

export function batchCutoff(status: CoxStatus, batch: number): number | null {
  if (status.currentBatch) return status.currentBatch.cutoff + (batch - status.currentBatch.batch) * BATCH_SECONDS;
  if (status.latestBatch !== null && status.latestCutoff !== null) return status.latestCutoff + (batch - status.latestBatch) * BATCH_SECONDS;
  return null;
}

export interface Point {
  cutoff: number;
  value: number;
}

export interface ClassView {
  id: string;
  backing: number;
  units: number;
  unitValue: number | null;
}

export function toNumber(value: string, digits: number): number {
  return Number(BigInt(value)) / 10 ** digits;
}

export function latestOf(publications: readonly Publication[]): Publication {
  const publication = publications[publications.length - 1];
  if (!publication) throw new Error("no publication");
  return publication;
}

export function priceOf(publication: Publication, assetId: string): PublishedPrice {
  const price = publication.prices.find((item) => item.assetId === assetId);
  if (!price) throw new Error(`no price for ${assetId}`);
  return price;
}

export function priceSeries(publications: readonly Publication[], assetId: string): Point[] {
  return publications.map((publication) => ({ cutoff: publication.identity.cutoff, value: toNumber(priceOf(publication, assetId).priceE8, PRICE_DIGITS) }));
}

export function referenceSeries(publications: readonly Publication[], assetId: string): Point[] {
  return publications.map((publication) => {
    const entry = publication.references.find((item) => item.assetId === assetId);
    if (!entry) throw new Error(`no reference for ${assetId}`);
    return { cutoff: publication.identity.cutoff, value: toNumber(entry.reference, SCALE_DIGITS) };
  });
}

export function levelSeries(publications: readonly Publication[]): Point[] {
  return publications.map((publication) => ({ cutoff: publication.identity.cutoff, value: toNumber(publication.benchmark, SCALE_DIGITS) }));
}

export function latest(points: readonly Point[]): number {
  return points[points.length - 1].value;
}

export function changeSince(points: readonly Point[], seconds: number): number {
  const end = points[points.length - 1];
  const start = points.find((point) => point.cutoff >= end.cutoff - seconds) ?? points[0];
  return end.value / start.value - 1;
}

function classView(valuation: ClassValuation, decimals: number): ClassView {
  const backing = toNumber(valuation.final.backing, decimals);
  const units = toNumber(valuation.final.units, SCALE_DIGITS);
  return { id: valuation.classId, backing, units, unitValue: units > 0 ? backing / units : null };
}

export function classViews(publication: Publication, decimals: number): ClassView[] {
  return publication.classes.map((valuation) => classView(valuation, decimals));
}

export function findClass(views: readonly ClassView[], id: string): ClassView {
  const view = views.find((item) => item.id === id);
  if (!view) throw new Error(`unknown class ${id}`);
  return view;
}

const venues: Record<PriceVenue, string> = { kraken: "Kraken", coinbase: "Coinbase", bybit: "Bybit" };

export function venueName(venue: PriceVenue): string {
  return venues[venue];
}

export function tradeAge(minutes: number): string {
  if (minutes === 0) return "traded in the cutoff minute";
  return `last trade ${minutes} min before the cutoff`;
}
