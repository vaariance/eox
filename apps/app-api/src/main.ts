import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Connection } from "@solana/web3.js";
import { loadProgram } from "./cox/chain.js";
import { CoxFixtureSource } from "./cox/fixture-source.js";
import { LiveCoxSource } from "./cox/live-source.js";
import { createCoxApiServer, type CoxApiServerOptions } from "./cox/server.js";
import { CoxSubmissions } from "./cox/submissions.js";
import { CoxTransactions } from "./cox/transactions.js";

const GENESIS: Record<string, string> = {
  "solana-devnet": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};
const POOL_WAIT_MS = 30_000;
const here = dirname(fileURLToPath(import.meta.url));

const mode = process.env.APP_API_SOURCE ?? "cox-fixture";
if (mode !== "cox-fixture" && mode !== "cox-live") throw new Error(`unsupported APP_API_SOURCE: ${mode}`);
const host = process.env.APP_API_HOST ?? "127.0.0.1";
const port = Number(process.env.APP_API_PORT ?? "8790");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid APP_API_PORT: ${port}`);

const corsOrigin = process.env.APP_API_CORS_ORIGIN ?? null;
if (corsOrigin !== null && corsOrigin !== "*" && !/^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(corsOrigin)) {
  throw new Error(`invalid APP_API_CORS_ORIGIN: ${corsOrigin}`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for APP_API_SOURCE=cox-live`);
  return value;
}

async function live(): Promise<Pick<CoxApiServerOptions, "source" | "transactions" | "submissions">> {
  const network = process.env.COX_NETWORK ?? "solana-devnet";
  const genesis = GENESIS[network];
  if (!genesis) throw new Error(`unsupported COX_NETWORK: ${network}`);
  const poolText = process.env.COX_POOL_ID ?? "0";
  if (!/^(0|[1-9][0-9]{0,18})$/.test(poolText)) throw new Error(`invalid COX_POOL_ID: ${poolText}`);
  const pollMs = Number(process.env.COX_POLL_MS ?? "5000");
  if (!Number.isInteger(pollMs) || pollMs < 1000) throw new Error(`invalid COX_POLL_MS: ${pollMs}`);
  const stateDir = resolve(required("APP_API_STATE_DIR"));
  const connection = new Connection(required("COX_RPC_URL"), "finalized");
  if ((await connection.getGenesisHash()) !== genesis) throw new Error(`COX_RPC_URL is not ${network}`);
  const program = loadProgram(connection, process.env.COX_IDL_PATH ?? join(here, "..", "..", "..", "packages", "cox", "idl", "cox.json"));
  const poolId = BigInt(poolText);
  const options = { connection, program, poolId, network, logPath: join(stateDir, `publications-${poolId}.jsonl`), pollMs, onError: (error: unknown) => console.error("cox indexer tick failed", error) };
  for (;;) {
    try {
      const source = await LiveCoxSource.open(options);
      await source.tick();
      source.start();
      const transactions = new CoxTransactions({
        connection, program, poolId, pool: source.poolAddress, vault: source.vaultAddress, mint: source.collateralMint, origin: source.manifest.origin, classes: source.classes,
      });
      const submissions = new CoxSubmissions({ connection, programId: program.programId, path: join(stateDir, `submissions-${poolId}.json`) });
      return { source, transactions, submissions };
    } catch (error) {
      if (!(error instanceof Error) || !["CoxAccountNotFound", "PoolMethodologyNotSealed"].includes(error.message)) throw error;
      console.log(`cox pool ${poolId} is not active on ${network} yet (${error.message}); checking again in ${POOL_WAIT_MS / 1000} s`);
      await sleep(POOL_WAIT_MS);
    }
  }
}

const sources = mode === "cox-live" ? await live() : { source: new CoxFixtureSource(join(here, "..", "fixtures", "cox-fixture.json")) };
const server = createCoxApiServer({ ...sources, corsOrigin, onError: (error) => console.error("app-api request failed", error) });
server.listen(port, host, () => console.log(`app-api (${mode}) listening on http://${host}:${port}`));

function shutdown(): void {
  server.close(() => process.exit(0));
  server.closeAllConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
