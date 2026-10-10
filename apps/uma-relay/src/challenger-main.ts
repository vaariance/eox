import { createSigningClient } from "@eox/signing";
import { type PublicClient, createPublicClient, getAddress, http } from "viem";

import { Challenger, emptyChallengerState } from "./challenger.js";
import { sourceSupportCheck } from "./checks.js";
import { identityToken, integer, log, required, runEvery } from "./env.js";
import { httpEvidenceSource } from "./evidence-source.js";
import { remoteSender } from "./remote-sender.js";
import { readState, writeState } from "./state-file.js";

const signerUrl = required("SIGNER_URL");
const audience = process.env.SIGNER_AUDIENCE ?? signerUrl;
const statePath = required("STATE_PATH");
const dispute = process.env.CHALLENGER_DISPUTE === "true";
const client = createPublicClient({ transport: http(required("RPC_URL")) }) as PublicClient;
const signer = createSigningClient({ baseUrl: signerUrl, identityToken: () => identityToken(audience) });

const challenger = new Challenger({
  client,
  adapter: getAddress(required("ADAPTER_ADDRESS")),
  sender: await remoteSender({ client, signer, role: "uma-challenger" }),
  checks: [sourceSupportCheck(httpEvidenceSource(required("EVIDENCE_API_URL")))],
  dispute,
  state: await readState(statePath, emptyChallengerState()),
  save: (state) => writeState(statePath, state),
  startBlock: integer("START_BLOCK", 0n),
  confirmations: integer("CONFIRMATIONS", 2n),
  log,
});

await runEvery(integer("TICK_SECONDS", 30n), dispute ? "uma-challenger (disputing)" : "uma-challenger (observing)", async () => {
  await challenger.tick();
});
