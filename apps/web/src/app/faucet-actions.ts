"use server";

import { Connection, PublicKey } from "@solana/web3.js";
import { CIRCLE_DEVNET_USDC } from "@/lib/config";
import type { Outcome } from "@/lib/requests";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const connection = new Connection(process.env.COX_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");

export interface FaucetBalances {
  lamports: string;
  usdc: string;
}

export async function faucetBalances(owner: string): Promise<Outcome<FaucetBalances>> {
  try {
    const key = new PublicKey(owner);
    const mint = new PublicKey(CIRCLE_DEVNET_USDC);
    const tokenAccount = PublicKey.findProgramAddressSync([key.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0];
    const [lamports, info] = await Promise.all([connection.getBalance(key), connection.getAccountInfo(tokenAccount)]);
    const usdc = info && info.owner.equals(TOKEN_PROGRAM) && info.data.length === 165 ? info.data.readBigUInt64LE(64) : 0n;
    return { ok: true, value: { lamports: lamports.toString(), usdc: usdc.toString() } };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    return { ok: false, code: "UNAVAILABLE", message: /429|Too Many/i.test(message) ? "The devnet connection is busy. Please try again in a moment." : "The balances could not be read." };
  }
}
