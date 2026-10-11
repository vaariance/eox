import { ComputeBudgetProgram, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import type { RejectionCode, SigningRole } from "@eox/signing";
import { SIGNER_ACCOUNT, type RoleBindings } from "./config.js";

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
      if (data[0] === SET_COMPUTE_UNIT_LIMIT && data.length === 5) {
        if (policy!.maxComputeUnitLimit !== undefined && data.readUInt32LE(1) > Number(policy!.maxComputeUnitLimit)) {
          deny("LIMIT_EXCEEDED", "compute unit limit exceeds the permitted maximum");
        }
        continue;
      }
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
    if (program!.enabled === false) deny("TARGET_NOT_BOUND", `program ${programId!.toBase58()} is prepared for ${role} but not enabled`);
    const discriminator = data.subarray(0, 8).toString("hex");
    if (!program!.discriminators.includes(discriminator)) {
      deny("OPERATION_NOT_PERMITTED", `instruction ${discriminator} is not permitted on ${programId!.toBase58()}`);
    }
    const rule = program!.instructions?.find((r) => r.discriminator === discriminator);
    if (program!.instructions && !rule) deny("OPERATION_NOT_PERMITTED", `instruction ${discriminator} has no account rule`);
    for (const [index, expected] of Object.entries(rule?.accounts ?? {})) {
      const key = message.staticAccountKeys[instruction.accountKeyIndexes[Number(index)]!];
      const want = expected === SIGNER_ACCOUNT ? signer : new PublicKey(expected);
      if (!key || !key.equals(want)) {
        deny("TARGET_NOT_BOUND", `instruction ${discriminator} account ${index} is ${key?.toBase58() ?? "missing"}, not ${want.toBase58()}`);
      }
    }
  }
}
