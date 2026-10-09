import { capturePayload, payloadText, type FetchedPayload } from "./payload.js";

const BASE_URL =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Ports_Data/FeatureServer/0/query";
const PAGE_SIZE = 1000;
const ISO3_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface PortRecord {
  date: string;
  iso3: string;
  portId: string;
  portCalls: string | null;
  importContainer: string | null;
  exportContainer: string | null;
}

interface ArcGISFeature {
  attributes: {
    date: string;
    ISO3: string;
    portid: string;
    portcalls_container: string | null;
    import_container: string | null;
    export_container: string | null;
  };
}

interface ArcGISQueryResponse {
  features?: ArcGISFeature[];
  exceededTransferLimit?: boolean;
  error?: { message?: string; code?: number };
}

interface ArcGISDateQueryResponse {
  features?: { attributes: { date: string } }[];
  error?: { message?: string; code?: number };
}

function assertValidIso3(code: string): void {
  if (!ISO3_PATTERN.test(code)) throw new Error(`invalid ISO3 code: ${code}`);
}

function assertValidDate(date: string): void {
  if (!DATE_PATTERN.test(date)) throw new Error(`invalid date: ${date}`);
}

export interface CountryPortPayload {
  payload: FetchedPayload;
  records: PortRecord[];
}

function buildWhereClause(iso3: string, date: string): string {
  assertValidIso3(iso3);
  assertValidDate(date);
  return `ISO3 = '${iso3}' AND date = DATE '${date}'`;
}

export async function fetchCountryPortRecords(iso3: string, date: string): Promise<CountryPortPayload> {
  const params = new URLSearchParams({
    where: buildWhereClause(iso3, date),
    outFields: "date,ISO3,portid,portcalls_container,import_container,export_container",
    f: "json",
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: "ObjectId",
    returnGeometry: "false",
  });
  const url = `${BASE_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PortWatch request failed: ${res.status} ${res.statusText}`);
  const payload = await capturePayload(url, res);
  const records = parsePortRecords(payloadText(payload));
  return { payload, records };
}

const DECIMAL_TEXT_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function exactNumbers(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value !== "number") return value;
  const source = context?.source;
  if (source === undefined || !DECIMAL_TEXT_PATTERN.test(source)) {
    throw new Error(`PortWatch number is not a plain decimal: ${source ?? value}`);
  }
  return source;
}

export function parsePortRecords(text: string): PortRecord[] {
  const body = JSON.parse(text, exactNumbers as (key: string, value: unknown) => unknown) as ArcGISQueryResponse;
  if (body.error) throw new Error(`PortWatch error: ${body.error.message ?? JSON.stringify(body.error)}`);
  if (body.exceededTransferLimit) throw new Error(`PortWatch returned more than ${PAGE_SIZE} ports in one response`);
  return (body.features ?? []).map((feature) => ({
    date: feature.attributes.date,
    iso3: feature.attributes.ISO3,
    portId: feature.attributes.portid,
    portCalls: feature.attributes.portcalls_container,
    importContainer: feature.attributes.import_container,
    exportContainer: feature.attributes.export_container,
  }));
}

export const PORTWATCH_DATASET = "Daily_Ports_Data";
const LAYER_URL = BASE_URL.slice(0, -"/query".length);

export interface LatestAvailableDate {
  payload: FetchedPayload;
  date: string;
}

export interface LayerMetadata {
  payload: FetchedPayload;
  dataLastEditDate: string;
}

export async function fetchLatestAvailableDate(): Promise<LatestAvailableDate> {
  const params = new URLSearchParams({
    where: "import_container IS NOT NULL",
    outFields: "date",
    f: "json",
    resultRecordCount: "1",
    orderByFields: "date DESC",
    returnGeometry: "false",
  });
  const url = `${BASE_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PortWatch request failed: ${res.status} ${res.statusText}`);
  const payload = await capturePayload(url, res);
  const body = JSON.parse(payloadText(payload)) as ArcGISDateQueryResponse;
  if (body.error) throw new Error(`PortWatch error: ${body.error.message ?? JSON.stringify(body.error)}`);
  const date = body.features?.[0]?.attributes.date;
  if (!date || !DATE_PATTERN.test(date)) throw new Error("PortWatch returned no available date");
  return { payload, date };
}

export function parseLayerMetadata(text: string): string {
  const body = JSON.parse(text) as { editingInfo?: { dataLastEditDate?: unknown }; error?: { message?: string } };
  if (body.error) throw new Error(`PortWatch error: ${body.error.message ?? JSON.stringify(body.error)}`);
  const millis = body.editingInfo?.dataLastEditDate;
  if (typeof millis !== "number" || !Number.isSafeInteger(millis) || millis <= 0) {
    throw new Error("PortWatch layer metadata has no data edit time");
  }
  return new Date(millis).toISOString();
}

export async function fetchLayerMetadata(): Promise<LayerMetadata> {
  const url = `${LAYER_URL}?f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PortWatch request failed: ${res.status} ${res.statusText}`);
  const payload = await capturePayload(url, res);
  return { payload, dataLastEditDate: parseLayerMetadata(payloadText(payload)) };
}
