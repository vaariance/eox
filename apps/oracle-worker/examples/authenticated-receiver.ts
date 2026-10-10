import type { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { AuthenticatedClient, ReceiverAddresses } from "../src/authenticated.js";
import type { EvidenceClaim, RelayMessage, SnapshotClaim } from "../src/protocol.js";

export async function prepareAuthenticatedClaim(input: {
  program: Program;
  epoch: PublicKey;
  snapshot: PublicKey;
  receiverId: string;
  evmChainId: string;
  uma: number[];
  journalPath: string;
  evidenceClaims: EvidenceClaim[];
  registrations: { message: RelayMessage; postedVaa: PublicKey }[];
  snapshotClaim: SnapshotClaim;
}): Promise<void> {
  const addresses = new ReceiverAddresses(input.program.programId, input.epoch, input.snapshot, input.receiverId, input.evmChainId, input.uma);
  const client = new AuthenticatedClient(input.program, addresses, input.journalPath);
  for (const claim of input.evidenceClaims) await client.uploadEvidenceClaim(claim);
  for (const registration of input.registrations) {
    await client.receiveRelay(registration.message, registration.postedVaa);
    await client.applyRelay(registration.message);
  }
  await client.freezeSnapshotClaim(input.snapshotClaim, input.evidenceClaims);
}
