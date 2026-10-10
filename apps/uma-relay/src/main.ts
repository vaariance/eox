import { createSigningClient } from "@eox/signing";
import { type PublicClient, createPublicClient, getAddress, http } from "viem";

import { Relay } from "./relay.js";
import { remoteSender } from "./remote-sender.js";
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

const relay = new Relay({
  client,
  adapter: getAddress(required("ADAPTER_ADDRESS")),
  sender: await remoteSender({ client, signer, role: "evm-relayer" }),
  state: await readState(statePath),
  save: (state) => writeState(statePath, state),
  startBlock: integer("START_BLOCK", 0n),
  confirmations: integer("CONFIRMATIONS", 2n),
  log,
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => (stopping = true));

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
