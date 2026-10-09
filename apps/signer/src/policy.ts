import { ComputeBudgetProgram, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import type { TransactionSerializable } from "viem";
import type { RejectionCode, SigningRole } from "@eox/signing";
import type { RoleBindings } from "./config.js";

export class PolicyRejection extends Error {
  constructor(
    readonly code: RejectionCode,
    message: string,
  ) {
    super(message);
  }
}

const deny = (code: RejectionCode, message: string): never => {
  throw new PolicyRejection(code, message);
};

export function checkEvmPolicy(
  role: SigningRole,
  bindings: RoleBindings | undefined,
  network: string,
  transaction: TransactionSerializable,
): void {
  const chainId = Number(network.slice("eip155:".length));
  if (transaction.chainId !== chainId) deny("NETWORK_NOT_PERMITTED", `transaction chain ${transaction.chainId} is not ${network}`);
  if (transaction.type !== "eip1559") deny("OPERATION_NOT_PERMITTED", `transaction type ${transaction.type} is not permitted`);
  const policy = bindings?.evm;
  if (!policy || policy.contracts.length === 0) deny("TARGET_NOT_BOUND", `${role} has no bound EVM contracts`);
  if (!transaction.to) deny("OPERATION_NOT_PERMITTED", "contract creation is not permitted");
  const contract = policy!.contracts.find((c) => c.address === transaction.to!.toLowerCase());
  if (!contract) deny("TARGET_NOT_BOUND", `${transaction.to} is not bound for ${role}`);
  const data = (transaction.data ?? "0x").toLowerCase();
  if (data.length < 10) deny("OPERATION_NOT_PERMITTED", "a contract call with a function selector is required");
  const selector = data.slice(0, 10);
  if (!contract!.selectors.includes(selector)) deny("OPERATION_NOT_PERMITTED", `selector ${selector} is not permitted on ${transaction.to}`);
  if ((transaction.value ?? 0n) > BigInt(contract!.maxValueWei)) deny("LIMIT_EXCEEDED", "value exceeds the permitted maximum");
  if ((transaction.maxFeePerGas ?? 0n) > BigInt(policy!.maxFeePerGasWei)) deny("LIMIT_EXCEEDED", "max fee per gas exceeds the permitted maximum");
  if ((transaction.gas ?? 0n) > BigInt(policy!.maxGas)) deny("LIMIT_EXCEEDED", "gas exceeds the permitted maximum");
  if ((transaction.accessList ?? []).length > 0) deny("OPERATION_NOT_PERMITTED", "access lists are not permitted");
}

const COMPUTE_BUDGET = ComputeBudgetProgram.programId;
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;

export function checkSolanaPolicy(
  role: SigningRole,
  bindings: RoleBindings | undefined,
  transaction: VersionedTransaction,
  signer: PublicKey,
): void {
  const message = transaction.message;
  if (message.addressTableLookups.length > 0) deny("OPERATION_NOT_PERMITTED", "address lookup tables are not permitted");
  if (!message.staticAccountKeys[0]?.equals(signer)) deny("OPERATION_NOT_PERMITTED", "the signing key must be the fee payer");
  const policy = bindings?.solana;
  if (!policy || policy.programs.length === 0) deny("TARGET_NOT_BOUND", `${role} has no bound Solana programs`);
  if (message.compiledInstructions.length === 0) deny("OPERATION_NOT_PERMITTED", "transaction has no instructions");
  for (const instruction of message.compiledInstructions) {
    const programId = message.staticAccountKeys[instruction.programIdIndex];
    if (!programId) deny("INVALID_REQUEST", "instruction references a missing program account");
    const data = Buffer.from(instruction.data);
    if (programId!.equals(COMPUTE_BUDGET)) {
      if (data[0] === SET_COMPUTE_UNIT_LIMIT && data.length === 5) continue;
      if (data[0] === SET_COMPUTE_UNIT_PRICE && data.length === 9) {
        if (data.readBigUInt64LE(1) > BigInt(policy!.maxComputeUnitPriceMicroLamports)) {
          deny("LIMIT_EXCEEDED", "compute unit price exceeds the permitted maximum");
        }
        continue;
      }
      deny("OPERATION_NOT_PERMITTED", "only compute unit limit and price instructions are permitted");
    }
    const program = policy!.programs.find((p) => p.programId === programId!.toBase58());
    if (!program) deny("TARGET_NOT_BOUND", `program ${programId!.toBase58()} is not bound for ${role}`);
    const discriminator = data.subarray(0, 8).toString("hex");
    if (!program!.discriminators.includes(discriminator)) {
      deny("OPERATION_NOT_PERMITTED", `instruction ${discriminator} is not permitted on ${programId!.toBase58()}`);
    }
  }
}
