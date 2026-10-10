import { type Hex, zeroHash } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Asserter, AsserterError } from "../src/asserter.js";
import { claimDigest } from "../src/digest.js";
import { BOND, type Chain, EPOCH, asserter, canRun, owner, startChain, word } from "./harness.js";

const PROPOSAL = word(0xc1);
const PRECOMMITMENT = word(0xc2);

describe.skipIf(!canRun)("asserter against the adapter on Anvil", () => {
  let chain: Chain;
  let service: Asserter;
  const balance = (account: Hex) => chain.read<bigint>("token", "balanceOf", [account]);
  const rejection = async (action: Promise<unknown>) => {
    const error = await action.then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(AsserterError);
    return error as AsserterError;
  };

  beforeAll(async () => {
    chain = await startChain(11545);
    service = new Asserter({ client: chain.client, adapter: chain.at.adapter, sender: chain.senderFor("asserter"), allowanceBonds: 8n });
  }, 30_000);

  afterAll(() => chain?.stop());

  it("approves a bounded allowance, posts the evidence and returns the assertion", async () => {
    const claim = chain.evidenceClaim(chain.record(10));
    const receipt = await service.assertEvidence({ proposal: PROPOSAL, precommitment: PRECOMMITMENT, claim });

    expect(receipt.created).toBe(true);
    expect(receipt.claimDigest).toBe(claimDigest("evidence", claim));
    expect(receipt.assertionId).not.toBe(zeroHash);
    expect(await chain.read("adapter", "assertionOf", [receipt.claimDigest])).toBe(receipt.assertionId);
    expect(await balance(chain.at.oracle)).toBe(BOND);
    expect(await chain.read("token", "allowance", [asserter.address, chain.at.adapter])).toBe(7n * BOND);
  });

  it("returns the same assertion for the same claim without a second bond", async () => {
    const claim = chain.evidenceClaim(chain.record(10));
    const nonce = await chain.client.getTransactionCount({ address: asserter.address });
    const again = await service.assertEvidence({ proposal: PROPOSAL, precommitment: PRECOMMITMENT, claim });

    expect(again.created).toBe(false);
    expect(again.assertionId).toBe(await chain.read("adapter", "assertionOf", [again.claimDigest]));
    expect(await balance(chain.at.oracle)).toBe(BOND);
    expect(await chain.client.getTransactionCount({ address: asserter.address })).toBe(nonce);
  });

  it("posts concurrent requests one at a time and then the snapshot", async () => {
    const records = [chain.record(20), chain.record(30)] as const;
    const proposal = word(0xd1);
    const precommitment = word(0xd2);
    const [first, second] = await Promise.all(
      records.map((item) => service.assertEvidence({ proposal, precommitment, claim: chain.evidenceClaim(item) })),
    );
    expect(first!.created && second!.created).toBe(true);
    expect(first!.assertionId).not.toBe(second!.assertionId);

    const claim = chain.snapshotClaim(proposal, precommitment, [records[0], records[1]], [first!.assertionId, second!.assertionId]);
    const snapshot = await service.assertSnapshot(claim);
    expect(snapshot.created).toBe(true);
    expect(snapshot.claimDigest).toBe(claimDigest("snapshot", claim));
    expect((await chain.read<{ snapshotAssertion: Hex }>("adapter", "proposal", [proposal])).snapshotAssertion).toBe(
      snapshot.assertionId,
    );
    expect((await service.assertSnapshot(claim)).created).toBe(false);
  });

  it("reports why the adapter rejects a claim and sends nothing", async () => {
    const nonce = await chain.client.getTransactionCount({ address: asserter.address });
    const wrongEpoch = chain.evidenceClaim(chain.record(40), { epoch: EPOCH + 1n });
    const error = await rejection(service.assertEvidence({ proposal: PROPOSAL, precommitment: PRECOMMITMENT, claim: wrongEpoch }));
    expect(error.code).toBe("CLAIM_REJECTED");
    expect(error.message).toBe("WrongContext");

    const malformed = await rejection(service.assertSnapshot("0x00"));
    expect(malformed.code).toBe("CLAIM_REJECTED");
    expect(malformed.message).toBe("InvalidProtocolEncoding");
    expect(await chain.client.getTransactionCount({ address: asserter.address })).toBe(nonce);
  });

  it("stops asserting when the wallet cannot cover one bond", async () => {
    await chain.send("token", "transfer", [owner.address, await balance(asserter.address)], "asserter");
    const nonce = await chain.client.getTransactionCount({ address: asserter.address });
    const claim = chain.evidenceClaim(chain.record(50));
    const error = await rejection(service.assertEvidence({ proposal: PROPOSAL, precommitment: PRECOMMITMENT, claim }));
    expect(error.code).toBe("UNDERFUNDED");
    expect(await chain.client.getTransactionCount({ address: asserter.address })).toBe(nonce);
  });
});
