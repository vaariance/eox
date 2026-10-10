import anchor, { type Idl } from "@coral-xyz/anchor";
import type { Server } from "node:http";
import { Connection } from "@solana/web3.js";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ReferenceReader } from "@eox/oracle-worker/references";
import { FixtureReferenceSource } from "./fixture-source.js";
import { PublicationIndexer } from "./indexer.js";
import { LiveReferenceSource, simulationProvider } from "./live-source.js";
import { ReadinessTracker } from "./readiness.js";
import type { ReferenceSource } from "./source.js";
import { createAppApiServer } from "./server.js";
import { SolanaChainClient } from "./solana-chain.js";
import { createCoxApiServer } from "./cox/server.js";
import { CoxFixtureSource } from "./cox/fixture-source.js";

const here = dirname(fileURLToPath(import.meta.url));

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function httpUrl(name: string): string {
  const url = new URL(required(name));
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must be an http(s) URL`);
  return url.toString().replace(/\/$/, "");
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid ${name}: ${process.env[name]}`);
  return value;
}

function repeat(name: string, intervalMs: number, task: () => Promise<unknown>): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`${name} failed`, error);
    }
    if (!stopped) timer = setTimeout(run, intervalMs);
  };
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

async function fixtureSource(): Promise<{ source: ReferenceSource; stop: () => void }> {
  const fixtures = join(here, "..", "fixtures");
  const source = new FixtureReferenceSource(
    join(fixtures, "oracle-preview.json"),
    join(fixtures, "timeline.json"),
    Math.floor(Date.now() / 1000),
  );
  return { source, stop: () => {} };
}

async function liveSource(): Promise<{ source: ReferenceSource; stop: () => void }> {
  const rpcUrl = httpUrl("SOLANA_RPC_URL");
  const evidenceUrl = httpUrl("EVIDENCE_API_URL");
  const stateDirectory = required("APP_API_STATE_DIR");
  const network = required("SOLANA_NETWORK");
  const pollMs = positiveInteger("APP_API_POLL_MS", 30_000);
  const rpcIntervalMs = positiveInteger("SOLANA_RPC_INTERVAL_MS", 400);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });

  const idl = JSON.parse(await readFile(join(here, "..", "..", "..", "packages", "oracle", "idl", "eox_oracle.json"), "utf8")) as Idl;
  const connection = new Connection(rpcUrl, "finalized");
  let live: LiveReferenceSource | undefined;
  const provider = simulationProvider(connection, () => live!.authority());
  const program = new anchor.Program(idl, provider);
  const reader = new ReferenceReader(program);
  const chain = new SolanaChainClient(connection, program, reader, reader.registry, rpcIntervalMs);
  const indexer = new PublicationIndexer(chain, join(stateDirectory, "publications.json"));
  const tracker = new ReadinessTracker(evidenceUrl, join(stateDirectory, "readiness.json"));
  await Promise.all([indexer.load(), tracker.load()]);

  live = new LiveReferenceSource({
    network,
    connection,
    program,
    reader,
    indexer,
    readiness: async () => tracker.readiness(Math.floor(Date.now() / 1000)),
    onError: (error) => console.error("publication read failed", error),
  });
  const stops = [repeat("publication indexer", pollMs, () => indexer.tick()), repeat("readiness tracker", pollMs, () => tracker.tick())];
  return { source: live, stop: () => stops.forEach((stop) => stop()) };
}

const mode = process.env.APP_API_SOURCE ?? "fixture";
if (mode !== "fixture" && mode !== "live" && mode !== "cox-fixture") throw new Error(`unsupported APP_API_SOURCE: ${mode}`);
const host = process.env.APP_API_HOST ?? "127.0.0.1";
const port = Number(process.env.APP_API_PORT ?? "8790");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid APP_API_PORT: ${port}`);

const onError = (error: unknown) => console.error("app-api request failed", error);
let stop: () => void = () => {};
let server: Server;
if (mode === "cox-fixture") {
  server = createCoxApiServer({ source: new CoxFixtureSource(join(here, "..", "fixtures", "cox-fixture.json")), onError });
} else {
  const built = mode === "live" ? await liveSource() : await fixtureSource();
  stop = built.stop;
  server = createAppApiServer({ source: built.source, onError });
}
server.listen(port, host, () => console.log(`app-api (${mode}) listening on http://${host}:${port}`));

function shutdown(): void {
  stop();
  server.close(() => process.exit(0));
  server.closeAllConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
