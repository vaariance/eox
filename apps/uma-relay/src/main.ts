import { createSigningClient } from "@eox/signing";
import { type PublicClient, createPublicClient, getAddress, http } from "viem";

import { Asserter } from "./asserter.js";
import { googleIdTokenVerifier } from "./auth.js";
import { firstLine, identityToken, integer, log, required, runEvery } from "./env.js";
import { Relay, emptyState } from "./relay.js";
import { remoteSender } from "./remote-sender.js";
import { createAssertionServer } from "./server.js";
import { readState, writeState } from "./state-file.js";

const signerUrl = required("SIGNER_URL");
const audience = process.env.SIGNER_AUDIENCE ?? signerUrl;
const statePath = required("STATE_PATH");
const client = createPublicClient({ transport: http(required("RPC_URL")) }) as PublicClient;
const signer = createSigningClient({ baseUrl: signerUrl, identityToken: () => identityToken(audience) });
const adapter = getAddress(required("ADAPTER_ADDRESS"));

const callers = new Set((process.env.ASSERTION_CALLERS ?? "").split(",").map((caller) => caller.trim()).filter(Boolean));
const server = createAssertionServer({
  verifyCaller: googleIdTokenVerifier(required("ASSERTION_AUDIENCE"), callers),
  asserter: new Asserter({ client, adapter, sender: await remoteSender({ client, signer, role: "uma-asserter" }) }),
  onRequest: (caller, route, receipt) =>
    log(`${caller} ${route} ${receipt.claimDigest} -> ${receipt.assertionId}${receipt.created ? "" : " (existing)"}`),
  onError: (error) => log(`assertion request failed: ${firstLine(error)}`),
});
const port = Number(integer("ASSERTION_PORT", 8792n));
const host = process.env.ASSERTION_HOST ?? "127.0.0.1";
await new Promise<void>((resolve) => server.listen(port, host, resolve));
log(`assertion API listening on ${host}:${port} for ${callers.size} caller(s)`);

const relay = new Relay({
  client,
  adapter,
  sender: await remoteSender({ client, signer, role: "evm-relayer" }),
  state: await readState(statePath, emptyState()),
  save: (state) => writeState(statePath, state),
  startBlock: integer("START_BLOCK", 0n),
  confirmations: integer("CONFIRMATIONS", 2n),
  log,
});

await runEvery(
  integer("TICK_SECONDS", 30n),
  "uma-relay",
  async () => {
    const { settled, closed, published } = await relay.tick();
    if (settled + closed + published > 0) log(`settled ${settled}, closed ${closed}, published ${published}`);
  },
  () => server.close(),
);
