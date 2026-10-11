"use server";

import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { Outcome } from "@/lib/requests";
import { CIRCLE_DEVNET_USDC } from "@/lib/config";
import { collateralBalance, connection, explain, sdk, tokenAccountOf, tokenBalance } from "@/lib/swap-chain";

export type SwapDirection = "buy" | "sell";

export interface SwapMarket {
  initialized: boolean;
  paused: boolean;
  halted: boolean;
  benchmarkLabel: string;
  collateralMint: string;
  earliestBatch: string;
  sequence: string;
}

export interface SwapBalances {
  collateral: string;
  availableUnits: string;
  lockedUnits: string;
  payable: string;
  refundable: string;
}

export interface SwapPrepared {
  transaction: string;
  kind: string;
  earliestBatch: string | null;
  expiryBatch: string | null;
}

export interface SwapSent {
  signature: string;
  state: "submitted" | "finalized" | "failed";
  error: string | null;
}

export interface FaucetBalances {
  lamports: string;
  circleUsdc: string;
  poolCollateral: string;
}

async function attempt<T>(call: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return { ok: false, ...explain(error) };
  }
}

function integer(text: string): bigint {
  if (!/^(0|[1-9][0-9]{0,38})$/.test(text)) throw new Error("That amount is not valid.");
  return BigInt(text);
}

export async function swapMarket(): Promise<Outcome<SwapMarket>> {
  return attempt(async () => {
    const market = await sdk.market();
    return {
      initialized: market.initialized,
      paused: market.paused,
      halted: market.halted,
      benchmarkLabel: market.benchmarkLabel,
      collateralMint: market.collateralMint.toBase58(),
      earliestBatch: market.earliestBatchEstimate.toString(),
      sequence: market.sequence.toString(),
    };
  });
}

export async function swapBalances(owner: string): Promise<Outcome<SwapBalances>> {
  return attempt(async () => {
    const key = new PublicKey(owner);
    const [balances, collateral] = await Promise.all([sdk.balances(key), collateralBalance(key)]);
    return {
      collateral: collateral.toString(),
      availableUnits: balances.availableUnits.toString(),
      lockedUnits: balances.locked.toString(),
      payable: balances.payable.toString(),
      refundable: balances.refundable.toString(),
    };
  });
}

export async function swapQuote(owner: string, direction: SwapDirection, amount: string): Promise<Outcome<string>> {
  return attempt(async () => {
    const key = new PublicKey(owner);
    const quote = direction === "buy" ? await sdk.quoteBuy(key, integer(amount)) : await sdk.quoteSell(key, integer(amount));
    return quote.estimatedOutput.toString();
  });
}

export async function swapPrepare(owner: string, direction: SwapDirection | "withdraw", amount: string, validForBatches: number): Promise<Outcome<SwapPrepared>> {
  return attempt(async () => {
    if (!Number.isSafeInteger(validForBatches) || validForBatches < 1 || validForBatches > 60) throw new Error("Choose how many batches the request stays valid for.");
    const key = new PublicKey(owner);
    const wallet = { owner: key, tokenAccount: tokenAccountOf(key) };
    const value = integer(amount);
    let plan;
    if (direction === "withdraw") {
      plan = await sdk.prepareWithdraw({ ...wallet, amount: value });
    } else {
      const market = await sdk.market();
      const expiryBatch = market.earliestBatchEstimate + BigInt(validForBatches - 1);
      plan = direction === "buy" ? await sdk.prepareBuy({ ...wallet, amount: value, minimumUnits: 0n, expiryBatch }) : await sdk.prepareSell({ ...wallet, units: value, minimumProceeds: 0n, expiryBatch });
    }
    const prepared = await sdk.transaction(plan);
    return {
      transaction: Buffer.from(prepared.transaction.serialize()).toString("base64"),
      kind: plan.kind,
      earliestBatch: plan.request?.earliestBatchEstimate.toString() ?? null,
      expiryBatch: plan.request?.expiryBatch.toString() ?? null,
    };
  });
}

export async function swapSend(signed: string): Promise<Outcome<SwapSent>> {
  return attempt(async () => {
    const transaction = VersionedTransaction.deserialize(Buffer.from(signed, "base64"));
    const signature = await connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: "confirmed" });
    return { signature, state: "submitted", error: null };
  });
}

export async function swapState(signature: string): Promise<Outcome<SwapSent>> {
  return attempt(async () => {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = value[0];
    if (!status) return { signature, state: "submitted", error: null };
    if (status.err) return { signature, state: "failed", error: JSON.stringify(status.err) };
    return { signature, state: status.confirmationStatus === "finalized" ? "finalized" : "submitted", error: null };
  });
}

export async function faucetBalances(owner: string): Promise<Outcome<FaucetBalances>> {
  return attempt(async () => {
    const key = new PublicKey(owner);
    const [lamports, circleUsdc, poolCollateral] = await Promise.all([connection.getBalance(key, "confirmed"), tokenBalance(key, new PublicKey(CIRCLE_DEVNET_USDC)), collateralBalance(key)]);
    return { lamports: lamports.toString(), circleUsdc: circleUsdc.toString(), poolCollateral: poolCollateral.toString() };
  });
}
