import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:http";
import { PublicKey } from "@solana/web3.js";
import { buildSlots, integer, type Configuration, type MathEvidence, type Rule, type Slot } from "./codec.js";
import { FixtureProvider, sha256, type FixtureFile } from "./provider.js";
import { Journal } from "./journal.js";
import { OracleWorker } from "./worker.js";
import { SolanaTransport } from "./solana.js";
import { runDemo } from "./demo.js";
import { retryDelay } from "./retry.js";
import { rustPreview } from "./preview.js";
import type { EvidenceRecord } from "./types.js";

const [command, ...args] = process.argv.slice(2);
function option(name: string, fallback?: string): string {
  const i = args.indexOf(`--${name}`); const value = i < 0 ? fallback : args[i + 1];
  if (!value) throw new Error(`Missing --${name}`); return value;
}
const output = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function fixture(): Promise<void> {
  const data = JSON.parse(await readFile(option("math-fixture"), "utf8")) as { evaluation_time: number; multiplier: number; countries: { id: string; rules: Rule[]; slots: Slot[] }[] };
  const now = Number(option("time", String(Math.floor(Date.now() / 1000))));
  const shift = now - data.evaluation_time;
  const artifact = Buffer.from("EOX synthetic fixture artifact v1\n");
  const records: EvidenceRecord[] = []; const changes: FixtureFile["changes"] = [];
  const config: Configuration = { epochId: option("epoch", "1"), multiplier: data.multiplier, countries: [] };
  for (const country of data.countries) {
    config.countries.push({ id: country.id, indicators: country.rules.map((rule, index) => ({ id: String(index), rule })) });
    country.slots.forEach((slot, index) => {
      const adapt = (e: MathEvidence): EvidenceRecord => {
        const amount = integer(e.value); const abs = amount < 0n ? -amount : amount;
        return { recordId: Buffer.from(e.record_id).toString("hex"), seriesId: Buffer.from(e.series_id).toString("hex"), revisionId: String(e.period), country: country.id, indicator: String(index), source: Buffer.from(e.source).toString("hex"), unit: Buffer.from(e.unit).toString("hex"), period: String(e.period), value: `${amount < 0n ? "-" : ""}${abs / 1_000_000n}.${String(abs % 1_000_000n).padStart(6, "0")}`, publishedAt: e.published_at === null ? null : Number(e.published_at) + shift, knownAt: e.known_at === null ? null : Number(e.known_at) + shift, recordedAt: Number(e.recorded_at) + shift, artifactDigest: sha256(artifact), manifest: "Synthetic fixture artifact v1; no real economic observations", confidenceBps: e.quality as EvidenceRecord["confidenceBps"] };
      };
      const current = adapt(slot.current);
      if (slot.comparison) { const comparison = adapt(slot.comparison); records.push(comparison); current.comparisonRecordId = comparison.recordId; }
      records.push(current); changes.push({ changeId: current.recordId, recordId: current.recordId });
    });
  }
  const directory = resolve(option("out")); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "config.json"), JSON.stringify(config, null, 2));
  await writeFile(join(directory, "stream.json"), JSON.stringify({ records, changes, artifacts: { [sha256(artifact)]: artifact.toString("base64") } }, null, 2));
  output({ fixture: join(directory, "stream.json"), config: join(directory, "config.json"), rebasedTo: now });
}

async function preview(): Promise<void> {
  const config = JSON.parse(await readFile(option("config"), "utf8")) as Configuration;
  const fixture = JSON.parse(await readFile(option("fixture"), "utf8")) as FixtureFile;
  const slots = buildSlots(config, fixture.records);
  const input = { evaluation_time: Number(option("time", String(Math.floor(Date.now() / 1000)))), multiplier: config.multiplier,
    countries: config.countries.map((c, i) => ({ id: c.id, rules: c.indicators.map(x => x.rule), slots: slots[i], histories: slots[i]!.map(() => [{ pending: 0, rejected: 0 }, { pending: 0, rejected: 0 }]) })), baseline: null };
  output(await rustPreview(resolve(option("binary")), input));
}

async function main(): Promise<void> {
  if (command === "fixture") return fixture();
  if (command === "preview") return preview();
  if (command === "serve-artifacts") {
    const provider = new FixtureProvider(option("fixture"));
    const server = createServer(async (request, response) => {
      const match = /^\/artifacts\/([a-f0-9]{64})$/.exec(request.url ?? "");
      if (request.method !== "GET" || !match) { response.writeHead(404).end(); return; }
      try { const bytes = await provider.retrieveArtifact(match[1]!); response.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "public, immutable", "ETag": `"${match[1]}"` }).end(bytes); }
      catch { response.writeHead(404).end(); }
    });
    server.listen(Number(option("port", "8788")), "127.0.0.1", () => output({ address: server.address(), path: "/artifacts/<sha256>" }));
    return;
  }
  if (command === "help" || !command) {
    console.log(`EOX oracle (real Solana RPC; no mock-chain fallback)
fixture --math-fixture PATH --out DIRECTORY [--time UNIX_SECONDS] [--epoch 1]
preview --config PATH --fixture PATH --binary RUST_CLI_PATH [--time UNIX_SECONDS]
serve-artifacts --fixture PATH [--port 8788]
init --adapter PUBKEY [connection options]
run --fixture PATH [--once] [connection options]
demo --fixture PATH --adapter-wallet PATH --binary RUST_CLI_PATH [connection options]
inspect [--snapshot PUBKEY] [connection options]
country --country US [--snapshot PUBKEY] [connection options]
pair --snapshot PUBKEY --base INDEX --quote INDEX [connection options]
challenge --adapter-wallet PATH --snapshot PUBKEY --action register|upheld|invalid|close
          [--id HEX32 --country 0 --page 0 --index 0 --comparison] [connection options]
Connection options: --rpc URL --idl PATH --wallet PATH --config PATH --state DIRECTORY
Closure is explicit and signed by the separate devnet adapter. The worker never auto-accepts evidence.`); return;
  }
  const directory = resolve(option("state"));
  const config = JSON.parse(await readFile(option("config"), "utf8")) as Configuration;
  const transport = await SolanaTransport.connect(option("rpc"), option("idl"), option("wallet"), config, join(directory, "bindings"));
  if (command === "init") return transport.bootstrap(new PublicKey(option("adapter")));
  if (command === "demo") return runDemo(transport, config, option("fixture"), directory, option("adapter-wallet"), resolve(option("binary")));
  if (command === "inspect") { output(await transport.inspect(args.includes("--snapshot") ? option("snapshot") : undefined)); return; }
  if (command === "country") { output(await transport.readCountry(config.countries.findIndex(c => c.id === option("country")), args.includes("--snapshot") ? option("snapshot") : undefined)); return; }
  if (command === "pair") { output(await transport.readPair(option("snapshot"), Number(option("base")), Number(option("quote")))); return; }
  if (command === "challenge") {
    const action = option("action"); if (!["register", "upheld", "invalid", "close"].includes(action)) throw new Error("InvalidChallengeAction");
    output({ signature: await transport.simulateChallenge(option("adapter-wallet"), option("snapshot"), action as "register" | "upheld" | "invalid" | "close", option("id", "0".repeat(64)), Number(option("country", "0")), Number(option("page", "0")), Number(option("index", "0")), args.includes("--comparison")) }); return;
  }
  if (command !== "run") throw new Error(`UnknownCommand:${command}`);
  const journal = new Journal(join(directory, "journal.json")); const release = await journal.lock();
  let stopped = false; const stop = () => { stopped = true; }; process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const worker = new OracleWorker(new FixtureProvider(option("fixture")), transport, journal, output,
      { batchSeconds: 5, refreshSeconds: 60 }, config.countries.flatMap(c => c.indicators.map(i => `${c.id}/${i.id}`)));
    let failures = 0;
    do {
      let wait = 1_000;
      try { await worker.tick(await transport.chainTime()); failures = 0; }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retry = retryDelay(error, ++failures);
        if (args.includes("--once") || retry === null) throw error;
        wait = retry;
        console.error(JSON.stringify({ error: message, retryAfterMs: wait }));
      }
      if (!args.includes("--once") && !stopped) await delay(wait);
    } while (!args.includes("--once") && !stopped);
  } finally { await release(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
