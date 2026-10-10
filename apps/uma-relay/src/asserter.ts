import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  type Hex,
  type PublicClient,
  encodeFunctionData,
  erc20Abi,
  zeroHash,
} from "viem";

import { adapterAbi, oracleAbi } from "./abi.js";
import { type ClaimKind, claimDigest } from "./digest.js";
import type { Operation, Sender, Transaction } from "./relay.js";

export type AsserterErrorCode = "CLAIM_REJECTED" | "UNDERFUNDED" | "NOT_CONFIRMED";

export class AsserterError extends Error {
  constructor(
    readonly code: AsserterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AsserterError";
  }
}

export interface AssertionReceipt {
  assertionId: Hex;
  claimDigest: Hex;
  created: boolean;
}

export interface AsserterOptions {
  client: PublicClient;
  adapter: Address;
  sender: Sender;
  allowanceBonds?: bigint;
  receiptTimeoutMs?: number;
}

export interface EvidenceRequest {
  proposal: Hex;
  precommitment: Hex;
  claim: Hex;
}

export class Asserter {
  private queue: Promise<unknown> = Promise.resolve();
  private addresses?: { oracle: Address; token: Address };

  constructor(private readonly options: AsserterOptions) {}

  assertEvidence(request: EvidenceRequest): Promise<AssertionReceipt> {
    const call = {
      abi: adapterAbi,
      functionName: "assertEvidence",
      args: [request.proposal, request.precommitment, request.claim],
    } as const;
    const { client, adapter, sender } = this.options;
    return this.serial(() =>
      this.assert("evidence", request.claim, encodeFunctionData(call), () =>
        client.simulateContract({ account: sender.address, address: adapter, ...call }),
      ),
    );
  }

  assertSnapshot(claim: Hex): Promise<AssertionReceipt> {
    const call = { abi: adapterAbi, functionName: "assertSnapshot", args: [claim] } as const;
    const { client, adapter, sender } = this.options;
    return this.serial(() =>
      this.assert("snapshot", claim, encodeFunctionData(call), () =>
        client.simulateContract({ account: sender.address, address: adapter, ...call }),
      ),
    );
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async assert(kind: ClaimKind, claim: Hex, data: Hex, simulate: () => Promise<unknown>): Promise<AssertionReceipt> {
    const digest = claimDigest(kind, claim);
    const existing = await this.assertionOf(digest);
    if (existing !== zeroHash) return { assertionId: existing, claimDigest: digest, created: false };

    await this.ensureBond();
    try {
      await simulate();
    } catch (error) {
      throw new AsserterError("CLAIM_REJECTED", revertReason(error));
    }
    await this.confirm({ to: this.options.adapter, data }, { id: `assert:${digest}`, kind: `assert-${kind}` });

    const assertionId = await this.assertionOf(digest);
    if (assertionId === zeroHash) throw new AsserterError("NOT_CONFIRMED", "the assertion was not registered");
    return { assertionId, claimDigest: digest, created: true };
  }

  private async ensureBond(): Promise<void> {
    const { client, adapter, sender } = this.options;
    const { oracle, token } = await this.contracts();
    const bond = await client.readContract({ address: oracle, abi: oracleAbi, functionName: "getMinimumBond", args: [token] });
    if (bond === 0n) return;
    const [balance, allowance] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [sender.address] }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [sender.address, adapter] }),
    ]);
    if (balance < bond) {
      throw new AsserterError("UNDERFUNDED", `the asserter holds ${balance} of the bond token and one bond is ${bond}`);
    }
    if (allowance >= bond) return;
    const amount = bond * (this.options.allowanceBonds ?? 16n);
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [adapter, amount] });
    await this.confirm({ to: token, data }, { id: `approve:${token}:${amount}`, kind: "approve" });
  }

  private async confirm(transaction: Transaction, operation: Operation): Promise<void> {
    const hash = await this.options.sender.send(transaction, operation);
    const receipt = await this.options.client.waitForTransactionReceipt({
      hash,
      timeout: this.options.receiptTimeoutMs ?? 120_000,
    });
    if (receipt.status !== "success") throw new AsserterError("NOT_CONFIRMED", `${operation.kind} reverted in ${hash}`);
  }

  private assertionOf(digest: Hex): Promise<Hex> {
    const { client, adapter } = this.options;
    return client.readContract({ address: adapter, abi: adapterAbi, functionName: "assertionOf", args: [digest] });
  }

  private async contracts(): Promise<{ oracle: Address; token: Address }> {
    const { client, adapter } = this.options;
    this.addresses ??= {
      oracle: await client.readContract({ address: adapter, abi: adapterAbi, functionName: "oracle" }),
      token: await client.readContract({ address: adapter, abi: adapterAbi, functionName: "bondCurrency" }),
    };
    return this.addresses;
  }
}

function revertReason(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return reverted.data?.errorName ?? reverted.shortMessage;
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
