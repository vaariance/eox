import { createHash } from "node:crypto";
import { PublicKey, type VersionedTransaction } from "@solana/web3.js";
import type { CoxLinkage, SolanaProgramBinding } from "./config.js";
import { PolicyRejection } from "./policy.js";

export interface ChainAccount {
  owner: PublicKey;
  data: Buffer;
}

export type AccountFetcher = (keys: PublicKey[]) => Promise<(ChainAccount | null)[]>;

const HEADER = 8 + 2 + 1;
const discriminator = (prefix: string, name: string) => createHash("sha256").update(`${prefix}:${name}`).digest().subarray(0, 8).toString("hex");
const INSTRUCTION = Object.fromEntries(
  ["publish", "evaluate", "safety", "seal_evaluation", "execute", "finalize"].map((name) => [discriminator("global", name), name]),
) as Record<string, string>;
const ACCOUNT = { Batch: discriminator("account", "Batch"), Request: discriminator("account", "Request") };

const deny = (message: string): never => {
  throw new PolicyRejection("TARGET_NOT_BOUND", message);
};

function u64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

export async function checkCoxLinkage(binding: SolanaProgramBinding, linkage: CoxLinkage, transaction: VersionedTransaction, fetch: AccountFetcher): Promise<void> {
  const program = new PublicKey(binding.programId);
  const pool = new PublicKey(linkage.pool);
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program)[0];
  if (!pda(Buffer.from("pool"), u64(BigInt(linkage.poolId))).equals(pool)) deny(`pool ${linkage.pool} is not pool ${linkage.poolId} of ${binding.programId}`);
  const message = transaction.message;

  async function stored(key: PublicKey, kind: keyof typeof ACCOUNT): Promise<Buffer> {
    const [account] = await fetch([key]);
    if (!account) return deny(`${kind} account ${key.toBase58()} does not exist`);
    if (!account.owner.equals(program)) deny(`${kind} account ${key.toBase58()} is not owned by the COX program`);
    if (account.data.subarray(0, 8).toString("hex") !== ACCOUNT[kind]) deny(`${key.toBase58()} is not a ${kind} account`);
    if (!new PublicKey(account.data.subarray(HEADER, HEADER + 32)).equals(pool)) deny(`${kind} ${key.toBase58()} belongs to another pool`);
    return account.data;
  }

  function methodology(account: PublicKey): void {
    if (linkage.methodology === null) deny("no sealed methodology is bound");
    if (!account.equals(new PublicKey(linkage.methodology!))) deny(`methodology ${account.toBase58()} is not the bound methodology`);
  }

  async function batch(account: PublicKey): Promise<{ sequence: bigint }> {
    const data = await stored(account, "Batch");
    const batchId = data.readBigUInt64LE(HEADER + 32);
    if (!pda(Buffer.from("batch"), pool.toBuffer(), u64(batchId)).equals(account)) deny(`batch ${account.toBase58()} is not the PDA of batch ${batchId}`);
    return { sequence: data.readBigUInt64LE(HEADER + 40) };
  }

  for (const instruction of message.compiledInstructions) {
    if (!message.staticAccountKeys[instruction.programIdIndex]!.equals(program)) continue;
    const data = Buffer.from(instruction.data);
    const name = INSTRUCTION[data.subarray(0, 8).toString("hex")];
    if (!name) deny("instruction is not a COX runtime instruction");
    const account = (index: number): PublicKey => {
      const key = message.staticAccountKeys[instruction.accountKeyIndexes[index]!];
      return key ?? deny(`${name} is missing account ${index}`);
    };
    if (name === "publish") {
      if (data.length < 16) deny("publish data is too short");
      methodology(account(4));
      if (!pda(Buffer.from("batch"), pool.toBuffer(), data.subarray(8, 16)).equals(account(5))) deny("publish batch is not the PDA of its batch id");
    } else if (name === "seal_evaluation") {
      await batch(account(2));
    } else if (name === "finalize") {
      const { sequence } = await batch(account(3));
      methodology(account(4));
      if (!pda(Buffer.from("publication"), pool.toBuffer(), u64(sequence)).equals(account(5))) deny("finalize publication is not the PDA of the batch sequence");
    } else {
      await batch(account(2));
      const request = await stored(account(3), "Request");
      const nonce = request.readBigUInt64LE(HEADER + 64);
      if (!pda(Buffer.from("request"), pool.toBuffer(), u64(nonce)).equals(account(3))) deny(`request ${account(3).toBase58()} is not the PDA of nonce ${nonce}`);
      const owner = request.subarray(HEADER + 32, HEADER + 64);
      if (!pda(Buffer.from("position"), pool.toBuffer(), owner).equals(account(4))) deny(`position ${account(4).toBase58()} is not the request owner's position`);
    }
  }
}
