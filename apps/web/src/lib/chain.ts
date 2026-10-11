import { type Idl, Program } from "@coral-xyz/anchor";
import { CoxInstructions, CoxReader } from "@cox/client";
import { type Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import idl from "../../../../packages/cox/idl/cox.json";
import type { RequestPlan } from "./requests";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export interface RequestAccounts {
  owner: PublicKey;
  pool: PublicKey;
  collateralMint: PublicKey;
  nonce: bigint;
}

export interface SubmitContext {
  connection: Connection;
  owner: PublicKey;
  poolId: bigint;
  send(transaction: Transaction, connection: Connection): Promise<string>;
}

export function coxProgram(connection: Connection): Program {
  return new Program(idl as Idl, { connection });
}

export function tokenAccount(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PROGRAM.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM)[0];
}

export function requestInstruction(program: Program, plan: RequestPlan, accounts: RequestAccounts): TransactionInstruction {
  const instructions = new CoxInstructions(program);
  const { pdas } = instructions;
  const keys = {
    owner: accounts.owner,
    pool: accounts.pool,
    vault: pdas.vault(accounts.pool),
    position: pdas.position(accounts.pool, accounts.owner),
    request: pdas.request(accounts.pool, accounts.nonce),
    userToken: tokenAccount(accounts.owner, accounts.collateralMint),
  };
  if (plan.operation === "deposit") return instructions.deposit(keys, plan.to, plan.amount, plan.minimumUnits, plan.expiryBatch);
  if (plan.operation === "redeem") return instructions.redeem(keys, plan.from, plan.units, plan.minimumProceeds, plan.expiryBatch);
  return instructions.switch(keys, plan.from, plan.to, plan.units, plan.minimumUnits, plan.expiryBatch);
}

export async function submitRequest(plan: RequestPlan, context: SubmitContext): Promise<{ signature: string; request: string }> {
  const { connection, owner, poolId } = context;
  const program = coxProgram(connection);
  const reader = new CoxReader(program);
  const pool = await reader.pool(poolId);
  const address = reader.pdas.pool(poolId);
  const nonce = BigInt(pool.nextRequestNonce.toString());

  if (plan.operation === "deposit") {
    const account = await connection.getAccountInfo(tokenAccount(owner, pool.collateralMint));
    if (!account) throw new Error("Your wallet has no test collateral yet, so there is nothing to buy with.");
  }

  const instruction = requestInstruction(program, plan, { owner, pool: address, collateralMint: pool.collateralMint, nonce });
  const transaction = new Transaction().add(instruction);
  transaction.feePayer = owner;
  const signature = await context.send(transaction, connection);
  return { signature, request: reader.pdas.request(address, nonce).toBase58() };
}
