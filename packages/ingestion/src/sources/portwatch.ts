const BASE_URL =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Ports_Data/FeatureServer/0/query";
const PAGE_SIZE = 1000;
const ISO3_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface PortRecord {
  date: string;
  iso3: string;
  portId: string;
  portCalls: number | null;
  importContainer: number | null;
  exportContainer: number | null;
}

interface ArcGISFeature {
  attributes: {
    date: string;
    ISO3: string;
    portid: string;
    portcalls_container: number | null;
    import_container: number | null;
    export_container: number | null;
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

function buildWhereClause(iso3Codes: readonly string[], date: string): string {
  iso3Codes.forEach(assertValidIso3);
  assertValidDate(date);
  const codeList = iso3Codes.map((code) => `'${code}'`).join(",");
  return `ISO3 IN (${codeList}) AND date = DATE '${date}'`;
}

async function queryPage(where: string, resultOffset: number): Promise<ArcGISQueryResponse> {
  const params = new URLSearchParams({
    where,
    outFields: "date,ISO3,portid,portcalls_container,import_container,export_container",
    f: "json",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(resultOffset),
    orderByFields: "ObjectId",
    returnGeometry: "false",
  });
  const res = await fetch(`${BASE_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`PortWatch request failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as ArcGISQueryResponse;
  if (body.error) throw new Error(`PortWatch error: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body;
}

export async function fetchPortRecords(iso3Codes: readonly string[], date: string): Promise<PortRecord[]> {
  const where = buildWhereClause(iso3Codes, date);
  const records: PortRecord[] = [];
  let offset = 0;
  for (;;) {
    const { features = [], exceededTransferLimit } = await queryPage(where, offset);
    for (const feature of features) {
      records.push({
        date: feature.attributes.date,
        iso3: feature.attributes.ISO3,
        portId: feature.attributes.portid,
        portCalls: feature.attributes.portcalls_container,
        importContainer: feature.attributes.import_container,
        exportContainer: feature.attributes.export_container,
      });
    }
    if (!exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }
  return records;
}

export async function fetchLatestAvailableDate(): Promise<string> {
  const params = new URLSearchParams({
    where: "import_container IS NOT NULL",
    outFields: "date",
    f: "json",
    resultRecordCount: "1",
    orderByFields: "date DESC",
    returnGeometry: "false",
  });
  const res = await fetch(`${BASE_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`PortWatch request failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as ArcGISDateQueryResponse;
  if (body.error) throw new Error(`PortWatch error: ${body.error.message ?? JSON.stringify(body.error)}`);
  const date = body.features?.[0]?.attributes.date;
  if (!date) throw new Error("PortWatch returned no available date");
  return date;
}
