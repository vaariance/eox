import { Program, type Idl } from "@coral-xyz/anchor";
import { CoxSwapSdk, DEVNET_TEST_COLLATERAL, SwapSdkError } from "@cox/client/swap";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../../../../packages/cox/idl/cox.json";

const POOL_ID = 0n;
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export const connection = new Connection(process.env.COX_RPC_URL ?? "https://api.devnet.solana.com", "finalized");
export const sdk = new CoxSwapSdk(new Program(idl as Idl, { connection }), { poolId: POOL_ID, collateralMint: DEVNET_TEST_COLLATERAL });

export const POOL_COLLATERAL = DEVNET_TEST_COLLATERAL.toBase58();

export function tokenAccountOf(owner: PublicKey, mint: PublicKey = DEVNET_TEST_COLLATERAL): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0];
}

export async function tokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(tokenAccountOf(owner, mint), "confirmed");
  if (!info || !info.owner.equals(TOKEN_PROGRAM) || info.data.length !== 165) return 0n;
  return info.data.readBigUInt64LE(64);
}

export async function collateralBalance(owner: PublicKey): Promise<bigint> {
  return tokenBalance(owner, DEVNET_TEST_COLLATERAL);
}

const reasons: Record<string, string> = {
  InvalidSwapAmount: "That amount is not valid.",
  SwapNetworkMismatch: "The network is not Solana devnet.",
  SwapSetupMissing: "The pool is not set up on this network.",
  SwapPoolNotInitialized: "The pool has not had its first publication yet, so swaps are not open.",
  SwapPaused: "The pool is paused.",
  SwapHalted: "The pool is halted because nothing has been published for an hour.",
  SwapCapacityExceeded: "The pool cannot take that much right now.",
  SwapInsufficientCollateral: "Your wallet does not hold enough of the pool's test USDC.",
  SwapWalletTokenMismatch: "Your wallet has no token account for the pool's test USDC yet.",
  SwapInsufficientUnlockedUnits: "You do not hold that many unlocked CRYPTO units.",
  SwapInsufficientPayable: "There is not that much ready to withdraw.",
  SwapExpiryTooEarly: "The batch moved on while this was being prepared. Please try again.",
  SwapNonceChangedRebuild: "Someone else queued a request at the same moment. Please try again.",
  SwapReadChangedRetry: "A publication landed while the estimate was being read. Please try again.",
};

export function explain(error: unknown): { code: string; message: string } {
  if (error instanceof SwapSdkError) return { code: error.code, message: reasons[error.code] ?? `The pool check failed (${error.code}).` };
  const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
  if (/429|Too Many Requests/i.test(message)) return { code: "RATE_LIMITED", message: "The devnet connection is busy. Please try again in a moment." };
  return { code: "UNAVAILABLE", message: message || "The devnet pool could not be reached." };
}
