import { type Address, type Hash, type Hex, type PublicClient, encodeFunctionData, erc20Abi, zeroAddress } from "viem";

import { CLAIM_EVIDENCE, adapterAbi, oracleAbi } from "./abi.js";
import { type EvidenceCheck, runChecks } from "./checks.js";
import { decodeEvidenceClaim } from "./claims.js";
import type { Operation, Sender, Transaction } from "./relay.js";

export type ClaimStatus = "pending" | "valid" | "invalid" | "disputed" | "missed";

export interface ClaimState {
  claim: Hex;
  status: ClaimStatus;
  reason?: string;
}

export interface ChallengerState {
  cursor: string | null;
  claims: Record<string, ClaimState>;
}

export interface ChallengerOptions {
  client: PublicClient;
  adapter: Address;
  sender: Sender;
  checks: readonly EvidenceCheck[];
  dispute: boolean;
  state: ChallengerState;
  save(state: ChallengerState): Promise<void>;
  startBlock: bigint;
  confirmations?: bigint;
  logRange?: bigint;
  receiptTimeoutMs?: number;
  log?(message: string): void;
}

export interface ChallengerTick {
  checked: number;
  invalid: number;
  disputed: number;
}

export function emptyChallengerState(): ChallengerState {
  return { cursor: null, claims: {} };
}

export class Challenger {
  private oracle?: Address;

  constructor(private readonly options: ChallengerOptions) {}

  get state(): ChallengerState {
    return this.options.state;
  }

  async tick(): Promise<ChallengerTick> {
    await this.sync();
    const result: ChallengerTick = { checked: 0, invalid: 0, disputed: 0 };
    const open = Object.entries(this.state.claims).filter(
      ([, claim]) => claim.status === "pending" || (claim.status === "invalid" && this.options.dispute),
    );
    if (open.length > 0) {
      const { client } = this.options;
      const oracle = await this.oracleAddress();
      const now = (await client.getBlock()).timestamp;
      for (const [assertionId, claim] of open) {
        const assertion = await client.readContract({
          address: oracle,
          abi: oracleAbi,
          functionName: "getAssertion",
          args: [assertionId as Hex],
        });
        if (assertion.disputer !== zeroAddress) {
          this.decide(assertionId, claim, "disputed", claim.reason ?? `disputed by ${assertion.disputer}`);
          continue;
        }
        if (assertion.settled || assertion.expirationTime <= now) {
          this.decide(assertionId, claim, "missed", claim.reason ?? "the challenge window closed before a verdict");
          continue;
        }
        if (claim.status === "pending") {
          result.checked += 1;
          const verdict = await this.verify(claim.claim);
          if (verdict.outcome === "unverified") {
            claim.reason = verdict.reason;
            this.options.log?.(`${assertionId} unverified: ${verdict.reason}`);
            continue;
          }
          if (verdict.outcome === "valid") {
            this.decide(assertionId, claim, "valid");
            continue;
          }
          result.invalid += 1;
          this.decide(assertionId, claim, "invalid", verdict.reason);
        }
        if (this.options.dispute && (await this.dispute(assertionId as Hex, assertion.currency, assertion.bond))) {
          result.disputed += 1;
          this.decide(assertionId, claim, "disputed", claim.reason);
        }
      }
    }
    await this.options.save(this.state);
    return result;
  }

  private async sync(): Promise<void> {
    const { client, adapter, startBlock } = this.options;
    const head = (await client.getBlockNumber({ cacheTime: 0 })) - (this.options.confirmations ?? 0n);
    const range = this.options.logRange ?? 5_000n;
    let from = this.state.cursor === null ? startBlock : BigInt(this.state.cursor) + 1n;
    while (from <= head) {
      const to = from + range - 1n < head ? from + range - 1n : head;
      const logs = await client.getContractEvents({
        address: adapter,
        abi: adapterAbi,
        eventName: "ClaimAsserted",
        fromBlock: from,
        toBlock: to,
        strict: true,
      });
      for (const log of logs) {
        if (log.args.kind !== CLAIM_EVIDENCE) continue;
        this.state.claims[log.args.assertionId] ??= { claim: log.args.claim, status: "pending" };
      }
      this.state.cursor = to.toString();
      from = to + 1n;
    }
  }

  private async verify(claim: Hex) {
    try {
      return await runChecks(this.options.checks, decodeEvidenceClaim(claim));
    } catch (error) {
      return { outcome: "unverified", reason: error instanceof Error ? error.message : String(error) } as const;
    }
  }

  private async dispute(assertionId: Hex, token: Address, bond: bigint): Promise<boolean> {
    const { client, sender } = this.options;
    const oracle = await this.oracleAddress();
    if (bond > 0n) {
      const [balance, allowance] = await Promise.all([
        client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [sender.address] }),
        client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [sender.address, oracle] }),
      ]);
      if (balance < bond) {
        this.options.log?.(`${assertionId} not disputed: the challenger holds ${balance} and the bond is ${bond}`);
        return false;
      }
      if (allowance < bond) {
        const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [oracle, bond] });
        if (!(await this.confirm({ to: token, data }, { id: `approve:${token}:${assertionId}`, kind: "approve" }))) return false;
      }
    }
    const data = encodeFunctionData({ abi: oracleAbi, functionName: "disputeAssertion", args: [assertionId, sender.address] });
    return this.confirm({ to: oracle, data }, { id: `dispute:${assertionId}`, kind: "dispute" });
  }

  private async confirm(transaction: Transaction, operation: Operation): Promise<boolean> {
    const { client, sender } = this.options;
    try {
      await client.call({ account: sender.address, ...transaction });
    } catch (error) {
      this.options.log?.(`${operation.id} not sent: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      return false;
    }
    const hash: Hash = await sender.send(transaction, operation);
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: this.options.receiptTimeoutMs ?? 120_000 });
    this.options.log?.(`${operation.id} ${receipt.status} in ${hash}`);
    return receipt.status === "success";
  }

  private decide(assertionId: string, claim: ClaimState, status: ClaimStatus, reason?: string): void {
    claim.status = status;
    if (reason === undefined) delete claim.reason;
    else claim.reason = reason;
    this.options.log?.(`${assertionId} ${status}${reason ? `: ${reason}` : ""}`);
  }

  private async oracleAddress(): Promise<Address> {
    const { client, adapter } = this.options;
    this.oracle ??= await client.readContract({ address: adapter, abi: adapterAbi, functionName: "oracle" });
    return this.oracle;
  }
}
