import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, link, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Program } from "@coral-xyz/anchor";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { addresses, checkedPublication, decodeAccount } from "@cox/client";
import type { PublisherIdentity } from "./types.ts";

interface HistoryRecord {
  schema: "cox.publication-archive/v1";
  identity: PublisherIdentity;
  address: string;
  sequence: string;
  batch: string;
  stateDigest: string;
  accountSha256: string;
  accountBase64: string;
  finalizedSlot: number;
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export class PublicationHistory {
  private readonly pool: PublicKey;
  private readonly address: PublicKey;
  constructor(readonly directory: string, private readonly program: Program, private readonly identity: PublisherIdentity, poolId: bigint) {
    this.pool = addresses(program.programId).pool(poolId);
    this.address = addresses(program.programId).publication(this.pool);
    if (identity.program !== program.programId.toBase58() || identity.pool !== this.pool.toBase58()) throw new Error("HistoryIdentityMismatch");
  }
  private checked(record: HistoryRecord) {
    if (!record || record.schema !== "cox.publication-archive/v1"
        || record.identity?.program !== this.identity.program || record.identity?.pool !== this.identity.pool
        || record.identity?.genesisHash !== this.identity.genesisHash || record.address !== this.address.toBase58()
        || typeof record.accountBase64 !== "string" || !Number.isSafeInteger(record.finalizedSlot) || record.finalizedSlot < 0) throw new Error("InvalidPublicationHistory");
    const bytes = Buffer.from(record.accountBase64, "base64");
    if (bytes.length !== 8192 || bytes.toString("base64") !== record.accountBase64 || hash(bytes) !== record.accountSha256) throw new Error("PublicationHistoryHashMismatch");
    const value = checkedPublication(this.program.programId, this.pool, decodeAccount(this.program, "publication", {
      data: bytes, owner: this.program.programId, executable: false, lamports: 0, rentEpoch: 0,
    }));
    if (value.sequence.toString() !== record.sequence || value.batch.toString() !== record.batch
        || Buffer.from(value.stateDigest).toString("hex") !== record.stateDigest) throw new Error("PublicationHistoryStateMismatch");
    return value;
  }
  async read(sequence: bigint) {
    if (sequence < 0n || sequence > (1n << 64n) - 1n) throw new Error("InvalidHistorySequence");
    const record = JSON.parse(await readFile(join(this.directory, sequence + ".json"), "utf8")) as HistoryRecord;
    const value = this.checked(record);
    if (value.sequence.toString() !== sequence.toString()) throw new Error("PublicationHistorySequenceMismatch");
    return { record, value };
  }
  async preserve(info: AccountInfo<Buffer>, finalizedSlot: number): Promise<void> {
    if (info.data.length !== 8192 || !Number.isSafeInteger(finalizedSlot) || finalizedSlot < 0) throw new Error("InvalidPublicationObservation");
    const value = checkedPublication(this.program.programId, this.pool, decodeAccount(this.program, "publication", info));
    const sequence = BigInt(value.sequence.toString());
    if (sequence > 0n) {
      let previous;
      try { previous = await this.read(sequence - 1n); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("PublicationHistoryGap:" + (sequence - 1n));
        throw error;
      }
      if (!Buffer.from(value.state.previousState).equals(Buffer.from(previous.value.stateDigest))) throw new Error("PublicationHistoryChainMismatch");
    } else if (Buffer.from(value.state.previousState).some(byte => byte !== 0)) throw new Error("PublicationHistoryOriginMismatch");
    const record: HistoryRecord = { schema: "cox.publication-archive/v1", identity: { ...this.identity },
      address: this.address.toBase58(), sequence: sequence.toString(), batch: value.batch.toString(),
      stateDigest: Buffer.from(value.stateDigest).toString("hex"), accountSha256: hash(info.data),
      accountBase64: info.data.toString("base64"), finalizedSlot };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    const path = join(this.directory, sequence + ".json");
    const file = await open(temporary, "wx", 0o600);
    try {
      try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
      try { await link(temporary, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await this.read(sequence);
        if (existing.record.accountBase64 !== record.accountBase64) throw new Error("PublicationHistoryConflict");
      }
      for (const directory of [this.directory, dirname(this.directory)]) {
        const parent = await open(directory, "r");
        try { await parent.sync(); } finally { await parent.close(); }
      }
    } finally { await unlink(temporary).catch(() => undefined); }
  }
}
