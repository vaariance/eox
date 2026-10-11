import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { TransactionSerializable } from "viem";
import type { RoleBindings } from "../src/config.js";
import { checkEvmPolicy, checkSolanaPolicy, PolicyRejection } from "../src/policy.js";

const contract = "0x1111111111111111111111111111111111111111";
const evmBindings: RoleBindings = {
  evm: {
    maxFeePerGasWei: "100000000000",
    maxGas: "500000",
    contracts: [{ address: contract, selectors: ["0xa9059cbb"], maxValueWei: "0" }],
  },
};

const evmCall = (overrides: Partial<TransactionSerializable> = {}): TransactionSerializable =>
  ({
    type: "eip1559",
    chainId: 11155111,
    nonce: 0,
    to: contract,
    data: "0xa9059cbb0000",
    value: 0n,
    gas: 100_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    ...overrides,
  }) as TransactionSerializable;

function rejects(fn: () => void, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof PolicyRejection && error.code === code);
}

test("permits a bound EVM call within limits", () => {
  checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", evmCall());
});

test("rejects EVM requests outside the bound policy", () => {
  rejects(() => checkEvmPolicy("uma-asserter", undefined, "eip155:11155111", evmCall()), "TARGET_NOT_BOUND");
  rejects(() => checkEvmPolicy("uma-asserter", evmBindings, "eip155:1", evmCall()), "NETWORK_NOT_PERMITTED");
  rejects(() => checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", evmCall({ to: undefined })), "OPERATION_NOT_PERMITTED");
  rejects(
    () => checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", evmCall({ to: "0x2222222222222222222222222222222222222222" })),
    "TARGET_NOT_BOUND",
  );
  rejects(() => checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", evmCall({ data: "0x095ea7b3" })), "OPERATION_NOT_PERMITTED");
  rejects(() => checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", evmCall({ data: "0x" })), "OPERATION_NOT_PERMITTED");
  rejects(() => checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", evmCall({ value: 1n })), "LIMIT_EXCEEDED");
  rejects(() => checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", evmCall({ gas: 500_001n })), "LIMIT_EXCEEDED");
  rejects(
    () => checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", evmCall({ maxFeePerGas: 100_000_000_001n })),
    "LIMIT_EXCEEDED",
  );
  rejects(
    () =>
      checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", evmCall({ accessList: [{ address: contract, storageKeys: [] }] })),
    "OPERATION_NOT_PERMITTED",
  );
  rejects(
    () => checkEvmPolicy("uma-asserter", evmBindings, "eip155:11155111", { ...evmCall(), type: "eip7702" } as TransactionSerializable),
    "OPERATION_NOT_PERMITTED",
  );
});

const program = Keypair.generate().publicKey;
const discriminator = Buffer.from("0102030405060708", "hex");
const solanaBindings: RoleBindings = {
  solana: { maxComputeUnitPriceMicroLamports: "1000", programs: [{ programId: program.toBase58(), discriminators: [discriminator.toString("hex")] }] },
};

function solanaTransaction(payer: PublicKey, instructions: TransactionInstruction[], tables: AddressLookupTableAccount[] = []) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions }).compileToV0Message(tables);
  return new VersionedTransaction(message);
}

const call = (payer: PublicKey, data = discriminator) =>
  new TransactionInstruction({ programId: program, keys: [{ pubkey: payer, isSigner: true, isWritable: true }], data });

test("permits a bound Solana instruction with compute budget settings", () => {
  const signer = Keypair.generate().publicKey;
  const tx = solanaTransaction(signer, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    call(signer),
  ]);
  checkSolanaPolicy("oracle-operator", solanaBindings, tx, signer);
});

test("rejects Solana requests outside the bound policy", () => {
  const signer = Keypair.generate().publicKey;
  rejects(() => checkSolanaPolicy("oracle-operator", undefined, solanaTransaction(signer, [call(signer)]), signer), "TARGET_NOT_BOUND");
  rejects(
    () => checkSolanaPolicy("oracle-operator", solanaBindings, solanaTransaction(signer, [call(signer, Buffer.from("ffffffffffffffff", "hex"))]), signer),
    "OPERATION_NOT_PERMITTED",
  );
  rejects(
    () =>
      checkSolanaPolicy(
        "oracle-operator",
        solanaBindings,
        solanaTransaction(signer, [call(signer), SystemProgram.transfer({ fromPubkey: signer, toPubkey: Keypair.generate().publicKey, lamports: 5 })]),
        signer,
      ),
    "TARGET_NOT_BOUND",
  );
  rejects(
    () =>
      checkSolanaPolicy(
        "oracle-operator",
        solanaBindings,
        solanaTransaction(signer, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1001 }), call(signer)]),
        signer,
      ),
    "LIMIT_EXCEEDED",
  );
  rejects(
    () =>
      checkSolanaPolicy(
        "oracle-operator",
        solanaBindings,
        solanaTransaction(signer, [ComputeBudgetProgram.requestHeapFrame({ bytes: 64 * 1024 }), call(signer)]),
        signer,
      ),
    "OPERATION_NOT_PERMITTED",
  );
  const otherPayer = Keypair.generate().publicKey;
  rejects(() => checkSolanaPolicy("oracle-operator", solanaBindings, solanaTransaction(otherPayer, [call(signer)]), signer), "OPERATION_NOT_PERMITTED");
});

test("rejects Solana transactions that use address lookup tables", () => {
  const signer = Keypair.generate().publicKey;
  const hidden = Keypair.generate().publicKey;
  const table = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [hidden] },
  });
  const instruction = new TransactionInstruction({
    programId: program,
    keys: [{ pubkey: hidden, isSigner: false, isWritable: true }],
    data: discriminator,
  });
  rejects(() => checkSolanaPolicy("oracle-operator", solanaBindings, solanaTransaction(signer, [instruction], [table]), signer), "OPERATION_NOT_PERMITTED");
});

test("enforces the compute unit limit and the bound accounts of each instruction", () => {
  const signer = Keypair.generate().publicKey;
  const registry = Keypair.generate().publicKey;
  const pool = Keypair.generate().publicKey;
  const bound: RoleBindings = {
    solana: {
      maxComputeUnitPriceMicroLamports: "1000",
      maxComputeUnitLimit: "1400000",
      programs: [
        {
          programId: program.toBase58(),
          discriminators: [discriminator.toString("hex")],
          instructions: [{ discriminator: discriminator.toString("hex"), accounts: { "0": "$signer", "1": registry.toBase58(), "2": pool.toBase58() } }],
        },
      ],
    },
  };
  const crank = (accounts: PublicKey[]) =>
    new TransactionInstruction({ programId: program, keys: accounts.map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: i !== 1 })), data: discriminator });
  checkSolanaPolicy("oracle-operator", bound, solanaTransaction(signer, [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), crank([signer, registry, pool])]), signer);
  rejects(
    () => checkSolanaPolicy("oracle-operator", bound, solanaTransaction(signer, [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_001 }), crank([signer, registry, pool])]), signer),
    "LIMIT_EXCEEDED",
  );
  rejects(() => checkSolanaPolicy("oracle-operator", bound, solanaTransaction(signer, [crank([signer, registry, Keypair.generate().publicKey])]), signer), "TARGET_NOT_BOUND");
  rejects(() => checkSolanaPolicy("oracle-operator", bound, solanaTransaction(signer, [crank([signer, registry])]), signer), "TARGET_NOT_BOUND");
  const other = Keypair.generate().publicKey;
  rejects(() => checkSolanaPolicy("oracle-operator", bound, solanaTransaction(signer, [crank([other, registry, pool])]), signer), "TARGET_NOT_BOUND");
});
