import {
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  erc20Abi,
} from "viem";

import { adapterAbi } from "./adapter-abi.js";
import { type Claim, resolutionUriHash } from "./payload.js";

export { adapterAbi };

type Wallet = WalletClient<Transport, Chain, Account>;

const wormholeFeeAbi = [
  { type: "function", name: "messageFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export interface EvmEpoch {
  opened: boolean;
  settled: boolean;
  methodologyImageId: Hex;
  bond: bigint;
  activeAssertion: Hex;
  resultAssertion: Hex;
  result: Claim;
}

export async function readEvmEpoch(client: PublicClient, adapter: Address, year: number): Promise<EvmEpoch> {
  return client.readContract({ address: adapter, abi: adapterAbi, functionName: "epochs", args: [year] });
}

/** Opens `year` on the adapter. Only the adapter's owner can. */
export async function openEvmEpoch(
  wallet: Wallet,
  client: PublicClient,
  adapter: Address,
  args: { year: number; methodologyImageId: Hex; bond: bigint },
): Promise<Hash> {
  const { request } = await client.simulateContract({
    account: wallet.account,
    address: adapter,
    abi: adapterAbi,
    functionName: "openEpoch",
    args: [args.year, args.methodologyImageId, args.bond],
  });
  return wallet.writeContract(request);
}

/**
 * Asserts `claim` as `year`'s result. Approves the epoch's bond first if the adapter's
 * allowance is short. Returns the assertion ID and the assertion transaction.
 */
export async function assertResult(
  wallet: Wallet,
  client: PublicClient,
  adapter: Address,
  args: { year: number; claim: Claim; resolutionUri: string },
): Promise<{ assertionId: Hex; hash: Hash }> {
  if (resolutionUriHash(args.resolutionUri) !== args.claim.resolutionUriHash.toLowerCase()) {
    throw new Error("claim.resolutionUriHash is not the SHA-256 of resolutionUri");
  }
  const [currency, epoch] = await Promise.all([
    client.readContract({ address: adapter, abi: adapterAbi, functionName: "bondCurrency" }),
    readEvmEpoch(client, adapter, args.year),
  ]);
  const allowance = await client.readContract({
    address: currency,
    abi: erc20Abi,
    functionName: "allowance",
    args: [wallet.account.address, adapter],
  });
  if (allowance < epoch.bond) {
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: currency,
      abi: erc20Abi,
      functionName: "approve",
      args: [adapter, epoch.bond],
    });
    await client.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
  }

  const { request, result } = await client.simulateContract({
    account: wallet.account,
    address: adapter,
    abi: adapterAbi,
    functionName: "assertResult",
    args: [args.year, args.claim, args.resolutionUri],
  });
  const hash = await wallet.writeContract(request);
  return { assertionId: result, hash };
}

/**
 * Publishes a settled epoch's result to Wormhole, paying the current message fee. The VAA
 * the guardians sign can then be posted to Solana and passed to `receiveResultInstruction`.
 */
export async function publishResult(wallet: Wallet, client: PublicClient, adapter: Address, year: number): Promise<Hash> {
  const wormhole = await client.readContract({ address: adapter, abi: adapterAbi, functionName: "wormhole" });
  const fee = await client.readContract({ address: wormhole, abi: wormholeFeeAbi, functionName: "messageFee" });
  const { request } = await client.simulateContract({
    account: wallet.account,
    address: adapter,
    abi: adapterAbi,
    functionName: "publishResult",
    args: [year],
    value: fee,
  });
  return wallet.writeContract(request);
}
