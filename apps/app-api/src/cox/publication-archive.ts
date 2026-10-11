import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Program } from "@coral-xyz/anchor";
import { addresses, checkedPublication, decodeAccount } from "@cox/client";
import type { PublicKey } from "@solana/web3.js";
import type { ChainPublication } from "./chain.js";

const SCHEMA = "cox.publication-archive/v1";
const ACCOUNT_BYTES = 8192;

interface ArchiveRecord {
  schema: string;
  identity: { program: string; pool: string; genesisHash: string };
  address: string;
  sequence: string;
  batch: string;
  stateDigest: string;
  accountSha256: string;
  accountBase64: string;
  finalizedSlot: number;
}

export class PublicationArchiveMissing extends Error {}

export class PublicationArchive {
  private readonly address: string;

  constructor(
    private readonly directory: string,
    private readonly program: Program,
    private readonly pool: PublicKey,
    private readonly genesisHash: string,
  ) {
    this.address = addresses(program.programId).publication(pool).toBase58();
  }

  read(sequence: bigint): { publication: ChainPublication; slot: number } {
    let text: string;
    try {
      text = readFileSync(join(this.directory, `${sequence}.json`), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PublicationArchiveMissing(`publication ${sequence} is not in the archive`);
      throw error;
    }
    const record = JSON.parse(text) as ArchiveRecord;
    if (record.schema !== SCHEMA || record.identity?.program !== this.program.programId.toBase58() || record.identity.pool !== this.pool.toBase58() || record.identity.genesisHash !== this.genesisHash) {
      throw new Error(`archived publication ${sequence} belongs to another program, pool or network`);
    }
    if (record.address !== this.address || record.sequence !== sequence.toString() || !Number.isSafeInteger(record.finalizedSlot) || record.finalizedSlot < 0) {
      throw new Error(`archived publication ${sequence} has the wrong address, sequence or slot`);
    }
    const bytes = Buffer.from(record.accountBase64, "base64");
    if (bytes.length !== ACCOUNT_BYTES || bytes.toString("base64") !== record.accountBase64 || createHash("sha256").update(bytes).digest("hex") !== record.accountSha256) {
      throw new Error(`archived publication ${sequence} fails its account hash`);
    }
    const account = decodeAccount(this.program, "publication", { data: bytes, owner: this.program.programId, executable: false, lamports: 0 });
    const publication = checkedPublication(this.program.programId, this.pool, account);
    if (publication.sequence.toString() !== record.sequence || publication.batch.toString() !== record.batch || Buffer.from(publication.stateDigest).toString("hex") !== record.stateDigest) {
      throw new Error(`archived publication ${sequence} does not match its record`);
    }
    return { publication, slot: record.finalizedSlot };
  }
}
