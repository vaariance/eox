import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getLatestSnapshotCutoff, pool, recordIncident, registerAsset } from "@eox/evidence-store";
import {
  ARCHIVE_DEADLINE_SECONDS,
  fetchListings,
  KrakenWsFeed,
  listingChanges,
  ROSTER,
  USDT_USD,
  VenueClient,
  type Listing,
  type ResolverDeps,
} from "@eox/price-feeds";
import { archiveCutoff } from "./archive-cutoff.js";

const RUN_DELAY_SECONDS = 6;
const LISTING_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CATCH_UP_DEADLINE_MS = 60_000;

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} must be set`);
  return value;
}

function minutes(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0 || value > 60) throw new Error(`${name} must be 0 to 60`);
  return value;
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

const userAgent = required("COX_USER_AGENT");
const stateDir = required("COX_ARCHIVER_STATE_DIR");
const catchUpMinutes = minutes("COX_CATCH_UP_MINUTES", 3);
const bybitEnabled = process.env.COX_BYBIT_ENABLED === "true";
const coinbaseEnabled = process.env.COX_COINBASE_ENABLED !== "false";

await mkdir(stateDir, { recursive: true, mode: 0o700 });
for (const asset of ROSTER) await registerAsset(asset);

const ws = new KrakenWsFeed({
  symbols: [...ROSTER.map((a) => a.krakenWsSymbol), USDT_USD.krakenWsSymbol],
  onError: (error) => log("kraken_ws_error", { error: String((error as { message?: string }).message ?? error) }),
});
ws.start();

const deps: ResolverDeps = {
  ws,
  kraken: new VenueClient("kraken", { requestsPerSecond: 0.5, userAgent }),
  coinbase: coinbaseEnabled ? new VenueClient("coinbase", { requestsPerSecond: 2, userAgent }) : null,
  bybit: bybitEnabled ? new VenueClient("bybit", { requestsPerSecond: 2, userAgent }) : null,
  deadlineFor: (cutoff) => {
    const deadline = (cutoff + ARCHIVE_DEADLINE_SECONDS) * 1000;
    return deadline > Date.now() ? deadline : Date.now() + CATCH_UP_DEADLINE_MS;
  },
};

const listingsPath = join(stateDir, "listings.json");

async function checkListings(cutoff: number): Promise<void> {
  let previous: Listing[] | null = null;
  try {
    previous = JSON.parse(await readFile(listingsPath, "utf8")) as Listing[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const current = await fetchListings(deps, ROSTER, Date.now() + 30_000);
  for (const change of listingChanges(previous, current)) {
    await recordIncident({ cutoff, kind: "listing_changed", assetId: null, venue: null, detail: change, rawSha256: null });
    log("listing_changed", { change });
  }
  await writeFile(`${listingsPath}.tmp`, JSON.stringify(current), { mode: 0o600 });
  await rename(`${listingsPath}.tmp`, listingsPath);
}

function metrics(): Record<string, unknown> {
  return {
    kraken: deps.kraken.metrics,
    coinbase: deps.coinbase?.metrics ?? null,
    bybit: deps.bybit?.metrics ?? null,
    krakenWs: ws.metrics,
  };
}

let lastListingCheck = 0;
let stopping = false;
let timer: NodeJS.Timeout | undefined;

async function tick(): Promise<void> {
  const latest = Math.floor(Date.now() / 60_000) * 60;
  const archived = await getLatestSnapshotCutoff();
  const windowStart = latest - catchUpMinutes * 60;
  const first = archived === null ? latest : Math.max(archived + 60, windowStart);
  if (archived !== null) {
    for (let missed = archived + 60; missed < first; missed += 60) {
      await recordIncident({ cutoff: missed, kind: "archive_late", assetId: null, venue: null, detail: "missed while the archiver was not running", rawSha256: null });
    }
  }
  for (let cutoff = first; cutoff <= latest && !stopping; cutoff += 60) {
    const started = Date.now();
    const result = await archiveCutoff(deps, ROSTER, cutoff);
    log("cutoff_archived", { cutoff, resolved: result.resolved, admissible: result.admissible, late: result.late, ms: Date.now() - started });
  }
  if (Date.now() - lastListingCheck >= LISTING_INTERVAL_MS) {
    lastListingCheck = Date.now();
    await checkListings(latest).catch((error: unknown) => log("listing_check_failed", { error: String(error) }));
  }
  log("venue_metrics", metrics());
}

function schedule(): void {
  if (stopping) return;
  const now = Date.now();
  const next = (Math.floor(now / 60_000) + 1) * 60_000 + RUN_DELAY_SECONDS * 1000;
  timer = setTimeout(() => {
    tick()
      .catch((error: unknown) => log("tick_failed", { error: error instanceof Error ? error.stack : String(error) }))
      .finally(schedule);
  }, next - now);
}

function shutdown(): void {
  stopping = true;
  clearTimeout(timer);
  ws.stop();
  void pool.end().finally(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
log("archiver_started", { assets: ROSTER.length, bybitEnabled, coinbaseEnabled, catchUpMinutes });
schedule();
