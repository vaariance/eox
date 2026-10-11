import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { loadSignerConfig } from "../src/config.js";
import { checkSolanaPolicy, PolicyRejection } from "../src/policy.js";

const config = loadSignerConfig(new URL("../config/dev.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const binding = config.bindings["oracle-operator"]!;
const cox = binding.solana!.programs[0]!;
const program = new PublicKey(cox.programId);
const poolId = Buffer.alloc(8);
const registry = PublicKey.findProgramAddressSync([Buffer.from("registry")], program)[0];
const pool = PublicKey.findProgramAddressSync([Buffer.from("pool"), poolId], program)[0];
const vault = PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], program)[0];
const discriminator = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex");
const operator = new PublicKey("GNmM11ZMFqEu3FYewGNDunpSSJBw8KnkDxzCGpSbpGj6");

test("binds the deployed COX program, pool 0 and only the publisher service", () => {
  assert.equal(cox.programId, "G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF");
  assert.deepEqual(cox.discriminators, ["publish", "evaluate", "safety", "seal_evaluation", "execute", "finalize"].map(discriminator));
  assert.deepEqual(config.callers, { "cox-publisher@colosseum-eox.iam.gserviceaccount.com": ["oracle-operator"] });
  for (const rule of cox.instructions!) {
    for (const account of Object.values(rule.accounts)) {
      assert.ok([registry, pool, vault, SystemProgram.programId].some((k) => k.toBase58() === account) || account === "$signer", account);
    }
  }
  const rule = (name: string) => cox.instructions!.find((r) => r.discriminator === discriminator(name))!.accounts;
  assert.deepEqual(rule("publish"), { "0": "$signer", "1": "$signer", "2": registry.toBase58(), "3": pool.toBase58(), "6": vault.toBase58(), "7": SystemProgram.programId.toBase58() });
  assert.deepEqual(rule("execute"), { "0": registry.toBase58(), "1": pool.toBase58(), "5": vault.toBase58() });
});

function publish(poolAccount: PublicKey) {
  const keys = [operator, operator, registry, poolAccount, Keypair.generate().publicKey, Keypair.generate().publicKey, vault, SystemProgram.programId];
  const instruction = new TransactionInstruction({
    programId: program,
    keys: keys.map((pubkey, i) => ({ pubkey, isSigner: i < 2, isWritable: [0, 2, 3, 5].includes(i) })),
    data: Buffer.concat([Buffer.from(discriminator("publish"), "hex"), Buffer.alloc(64)]),
  });
  const message = new TransactionMessage({
    payerKey: operator,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), instruction],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

test("ships disabled for pool 0 with no methodology until Peter supplies the activated accounts", () => {
  assert.equal(cox.enabled, false);
  assert.deepEqual(cox.linkage, { kind: "cox-v1", poolId: "0", pool: pool.toBase58(), methodology: null });
  assert.throws(() => checkSolanaPolicy("oracle-operator", binding, publish(pool), operator), (e) => e instanceof PolicyRejection && /not enabled/.test(e.message));
});

test("once enabled, accepts a well-formed publish and refuses one aimed at another pool", () => {
  const enabled = { solana: { ...binding.solana!, programs: [{ ...cox, enabled: true }] } };
  checkSolanaPolicy("oracle-operator", enabled, publish(pool), operator);
  assert.throws(() => checkSolanaPolicy("oracle-operator", enabled, publish(Keypair.generate().publicKey), operator), (e) => e instanceof PolicyRejection && e.code === "TARGET_NOT_BOUND");
});
