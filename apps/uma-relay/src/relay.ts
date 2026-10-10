import {
  type Address,
  type Hash,
  type Hex,
  type Log,
  type PublicClient,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  encodeFunctionData,
} from "viem";

import { CLAIM_SNAPSHOT, STATUS_PENDING, adapterAbi, oracleAbi, wormholeAbi } from "./abi.js";
import { snapshotEvidence } from "./claims.js";

export interface Transaction {
  to: Address;
  data: Hex;
  value?: bigint;
}

export interface Operation {
  id: string;
  kind: "settle" | "close" | "publish" | "approve" | "assert-evidence" | "assert-snapshot" | "dispute";
}

export interface Sender {
  readonly address: Address;
  send(transaction: Transaction, operation: Operation): Promise<Hash>;
}

export interface ProposalState {
  evidence: Hex[] | null;
  closed: boolean;
  messages: Record<string, Hex>;
  published: string[];
}

export interface RelayState {
  cursor: string | null;
  assertions: Record<string, { proposal: Hex; resolved: boolean }>;
  proposals: Record<string, ProposalState>;
  inFlight: Record<string, Hash>;
}

export interface RelayOptions {
  client: PublicClient;
  adapter: Address;
  sender: Sender;
  state: RelayState;
  save(state: RelayState): Promise<void>;
  startBlock: bigint;
  confirmations?: bigint;
  logRange?: bigint;
  receiptTimeoutMs?: number;
  log?(message: string): void;
}

export interface TickResult {
  settled: number;
  closed: number;
  published: number;
}

type Outcome = "success" | "reverted" | "pending" | "dropped";

export function emptyState(): RelayState {
  return { cursor: null, assertions: {}, proposals: {}, inFlight: {} };
}

export class Relay {
  private addresses?: { oracle: Address; wormhole: Address };

  constructor(private readonly options: RelayOptions) {}

  get state(): RelayState {
    return this.options.state;
  }

  async tick(): Promise<TickResult> {
    await this.sync();
    const settled = await this.settle();
    const closed = await this.close();
    const published = await this.publish();
    await this.options.save(this.state);
    return { settled, closed, published };
  }

  private async sync(): Promise<void> {
    const { client, adapter, startBlock } = this.options;
    const head = (await client.getBlockNumber({ cacheTime: 0 })) - (this.options.confirmations ?? 0n);
    const range = this.options.logRange ?? 5_000n;
    let from = this.state.cursor === null ? startBlock : BigInt(this.state.cursor) + 1n;
    while (from <= head) {
      const to = from + range - 1n < head ? from + range - 1n : head;
      const logs = await client.getContractEvents({ address: adapter, abi: adapterAbi, fromBlock: from, toBlock: to, strict: true });
      for (const log of logs) this.apply(log);
      this.state.cursor = to.toString();
      from = to + 1n;
    }
  }

  private apply(log: Log<bigint, number, false, undefined, true, typeof adapterAbi>): void {
    switch (log.eventName) {
      case "ClaimAsserted": {
        const { proposal, assertionId, kind, claim } = log.args;
        this.state.assertions[assertionId] ??= { proposal, resolved: false };
        if (kind === CLAIM_SNAPSHOT) this.proposal(proposal).evidence = snapshotEvidence(claim);
        return;
      }
      case "RelayMessageRecorded":
        this.proposal(log.args.proposal).messages[log.args.eventNumber.toString()] = log.args.message;
        return;
      case "RelayMessagePublished":
        this.markPublished(this.proposal(log.args.proposal), log.args.eventNumber.toString());
        return;
      case "ProposalClosed":
        this.proposal(log.args.proposal).closed = true;
        return;
    }
  }

  private async settle(): Promise<number> {
    const { client, adapter } = this.options;
    const pending = Object.entries(this.state.assertions).filter(([, assertion]) => !assertion.resolved);
    if (pending.length === 0) return 0;
    const { oracle } = await this.contracts();
    const now = (await client.getBlock()).timestamp;
    let settled = 0;
    for (const [assertionId, assertion] of pending) {
      const record = await client.readContract({ address: adapter, abi: adapterAbi, functionName: "assertion", args: [assertionId as Hex] });
      if (record.status !== STATUS_PENDING) {
        assertion.resolved = true;
        continue;
      }
      if (record.deadline > now) continue;
      const data = encodeFunctionData({ abi: oracleAbi, functionName: "settleAssertion", args: [assertionId as Hex] });
      if (await this.attempt({ id: `settle:${assertionId}`, kind: "settle" }, { to: oracle, data })) {
        assertion.resolved = true;
        settled += 1;
      }
    }
    return settled;
  }

  private async close(): Promise<number> {
    let closed = 0;
    for (const [proposalId, proposal] of Object.entries(this.state.proposals)) {
      if (proposal.closed || proposal.evidence === null) continue;
      const data = encodeFunctionData({ abi: adapterAbi, functionName: "close", args: [proposalId as Hex, proposal.evidence] });
      if (await this.attempt({ id: `close:${proposalId}`, kind: "close" }, { to: this.options.adapter, data })) {
        proposal.closed = true;
        closed += 1;
      }
    }
    return closed;
  }

  private async publish(): Promise<number> {
    let fee: bigint | undefined;
    let published = 0;
    for (const [proposalId, proposal] of Object.entries(this.state.proposals)) {
      const numbers = Object.keys(proposal.messages).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
      for (const eventNumber of numbers) {
        if (proposal.published.includes(eventNumber)) continue;
        fee ??= await this.options.client.readContract({
          address: (await this.contracts()).wormhole,
          abi: wormholeAbi,
          functionName: "messageFee",
        });
        const data = encodeFunctionData({
          abi: adapterAbi,
          functionName: "publish",
          args: [proposalId as Hex, BigInt(eventNumber), proposal.messages[eventNumber]!],
        });
        const operation: Operation = { id: `publish:${proposalId}:${eventNumber}`, kind: "publish" };
        if (await this.attempt(operation, { to: this.options.adapter, data, value: fee })) {
          this.markPublished(proposal, eventNumber);
          published += 1;
        }
      }
    }
    return published;
  }

  private async attempt(operation: Operation, transaction: Transaction): Promise<boolean> {
    const { client, sender } = this.options;
    const key = operation.id;
    const earlier = this.state.inFlight[key];
    if (earlier) {
      const outcome = await this.outcome(earlier);
      if (outcome === "pending") return false;
      delete this.state.inFlight[key];
      if (outcome === "success") return true;
    }
    try {
      await client.call({ account: sender.address, ...transaction });
    } catch (error) {
      this.options.log?.(`${key} not sent: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      return false;
    }
    const hash = await sender.send(transaction, operation);
    this.state.inFlight[key] = hash;
    await this.options.save(this.state);
    try {
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: this.options.receiptTimeoutMs ?? 120_000 });
      delete this.state.inFlight[key];
      this.options.log?.(`${key} ${receipt.status} in ${hash}`);
      return receipt.status === "success";
    } catch (error) {
      if (!(error instanceof WaitForTransactionReceiptTimeoutError)) throw error;
      this.options.log?.(`${key} still pending in ${hash}`);
      return false;
    }
  }

  private async outcome(hash: Hash): Promise<Outcome> {
    const { client } = this.options;
    try {
      return (await client.getTransactionReceipt({ hash })).status;
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
    }
    try {
      await client.getTransaction({ hash });
      return "pending";
    } catch (error) {
      if (!(error instanceof TransactionNotFoundError)) throw error;
      return "dropped";
    }
  }

  private async contracts(): Promise<{ oracle: Address; wormhole: Address }> {
    const { client, adapter } = this.options;
    this.addresses ??= {
      oracle: await client.readContract({ address: adapter, abi: adapterAbi, functionName: "oracle" }),
      wormhole: await client.readContract({ address: adapter, abi: adapterAbi, functionName: "wormhole" }),
    };
    return this.addresses;
  }

  private proposal(proposalId: Hex): ProposalState {
    return (this.state.proposals[proposalId] ??= { evidence: null, closed: false, messages: {}, published: [] });
  }

  private markPublished(proposal: ProposalState, eventNumber: string): void {
    if (!proposal.published.includes(eventNumber)) proposal.published.push(eventNumber);
  }
}
