import { createSigningClient } from "@eox/signing";
import { type PublicClient, createPublicClient, getAddress, http } from "viem";

import { Asserter } from "./asserter.js";
import { googleIdTokenVerifier } from "./auth.js";
import { Relay } from "./relay.js";
import { remoteSender } from "./remote-sender.js";
import { createAssertionServer } from "./server.js";
import { readState, writeState } from "./state-file.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(name: string, fallback: bigint): bigint {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(value);
}

async function identityToken(audience: string): Promise<string> {
  const url = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
  url.searchParams.set("audience", audience);
  const response = await fetch(url, { headers: { "Metadata-Flavor": "Google" } });
  if (!response.ok) throw new Error(`identity token request failed with HTTP ${response.status}`);
  return response.text();
}

const log = (message: string) => process.stdout.write(`${new Date().toISOString()} ${message}\n`);

const signerUrl = required("SIGNER_URL");
const audience = process.env.SIGNER_AUDIENCE ?? signerUrl;
const statePath = required("STATE_PATH");
const tickMs = Number(integer("TICK_SECONDS", 30n)) * 1000;
const client = createPublicClient({ transport: http(required("RPC_URL")) }) as PublicClient;
const signer = createSigningClient({ baseUrl: signerUrl, identityToken: () => identityToken(audience) });

const adapter = getAddress(required("ADAPTER_ADDRESS"));

const callers = new Set((process.env.ASSERTION_CALLERS ?? "").split(",").map((caller) => caller.trim()).filter(Boolean));
const server = createAssertionServer({
  verifyCaller: googleIdTokenVerifier(required("ASSERTION_AUDIENCE"), callers),
  asserter: new Asserter({ client, adapter, sender: await remoteSender({ client, signer, role: "uma-asserter" }) }),
  onRequest: (caller, route, receipt) =>
    log(`${caller} ${route} ${receipt.claimDigest} -> ${receipt.assertionId}${receipt.created ? "" : " (existing)"}`),
  onError: (error) => log(`assertion request failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`),
});
const port = Number(integer("ASSERTION_PORT", 8792n));
const host = process.env.ASSERTION_HOST ?? "127.0.0.1";
await new Promise<void>((resolve) => server.listen(port, host, resolve));
log(`assertion API listening on ${host}:${port} for ${callers.size} caller(s)`);

const relay = new Relay({
  client,
  adapter,
  sender: await remoteSender({ client, signer, role: "evm-relayer" }),
  state: await readState(statePath),
  save: (state) => writeState(statePath, state),
  startBlock: integer("START_BLOCK", 0n),
  confirmations: integer("CONFIRMATIONS", 2n),
  log,
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    server.close();
  });
}

log("uma-relay started");
while (!stopping) {
  try {
    const { settled, closed, published } = await relay.tick();
    if (settled + closed + published > 0) log(`settled ${settled}, closed ${closed}, published ${published}`);
  } catch (error) {
    log(`tick failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, tickMs));
}
log("uma-relay stopped");
