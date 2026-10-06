import {
  AccountRole,
  type Address,
  type Instruction,
  type TransactionSigner,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { type Address as EvmAddress, type Hex, bytesToHex, hexToBytes, isAddress, pad, sha256, size, stringToBytes } from "viem";

import type { Claim } from "./payload.js";

export const PROGRAM_ID = address("DDReyVxqqL3AtC8D6qpbnotZK1c8WBTN2nPdx1WtPHMt");

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const BPF_LOADER_UPGRADEABLE = address("BPFLoaderUpgradeab1e11111111111111111111111");

export type EpochStatus = "open" | "settled" | "voided";

export interface SolanaEpoch {
  year: number;
  cutoff: bigint;
  methodologyImageId: Hex;
  status: EpochStatus;
  result: Claim | null;
  /** The UMA assertion that settled the epoch, zero until then. */
  assertionId: Hex;
  wormholeSequence: bigint;
  bump: number;
}

export interface SolanaConfig {
  authority: Address;
  wormholeProgram: Address;
  emitterChain: number;
  emitterAddress: Hex;
  bump: number;
}

/** Anchor's 8-byte discriminator: the start of sha256("<namespace>:<name>"). */
export function discriminator(namespace: "global" | "account", name: string): Uint8Array {
  return hexToBytes(sha256(stringToBytes(`${namespace}:${name}`))).subarray(0, 8);
}

/** An EVM address as Wormhole names emitters: left-padded to 32 bytes. */
export function evmEmitterAddress(evmAddress: EvmAddress): Hex {
  if (!isAddress(evmAddress)) throw new Error(`not an EVM address: ${evmAddress}`);
  return pad(evmAddress.toLowerCase() as Hex, { size: 32 });
}

const u16le = (n: number) => new Uint8Array([n & 0xff, n >> 8]);

function bytes32(name: string, value: Hex): Uint8Array {
  if (size(value) !== 32) throw new Error(`${name} must be 32 bytes`);
  return hexToBytes(value);
}

export async function configAddress(programId: Address = PROGRAM_ID): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: programId, seeds: [stringToBytes("config")] });
  return pda;
}

export async function epochAddress(year: number, programId: Address = PROGRAM_ID): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: programId, seeds: [stringToBytes("epoch"), u16le(year)] });
  return pda;
}

async function programDataAddress(programId: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE,
    seeds: [getAddressEncoder().encode(programId)],
  });
  return pda;
}

function data(name: string, ...args: Uint8Array[]): Uint8Array {
  const parts = [discriminator("global", name), ...args];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** One-time setup. `authority` must hold the program's upgrade authority. */
export async function initializeInstruction(args: {
  authority: TransactionSigner;
  wormholeProgram: Address;
  emitterChain: number;
  emitterAddress: Hex;
  programId?: Address;
}): Promise<Instruction> {
  const programId = args.programId ?? PROGRAM_ID;
  return {
    programAddress: programId,
    accounts: [
      { address: args.authority.address, role: AccountRole.WRITABLE_SIGNER, signer: args.authority },
      { address: await configAddress(programId), role: AccountRole.WRITABLE },
      { address: programId, role: AccountRole.READONLY },
      { address: await programDataAddress(programId), role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: data(
      "initialize",
      getAddressEncoder().encode(args.wormholeProgram) as Uint8Array,
      u16le(args.emitterChain),
      bytes32("emitterAddress", args.emitterAddress),
    ),
  } as Instruction;
}

/** Opens `year` with its methodology. Open the same epoch on the adapter. */
export async function openEpochInstruction(args: {
  authority: TransactionSigner;
  year: number;
  methodologyImageId: Hex;
  programId?: Address;
}): Promise<Instruction> {
  const programId = args.programId ?? PROGRAM_ID;
  return {
    programAddress: programId,
    accounts: [
      { address: args.authority.address, role: AccountRole.WRITABLE_SIGNER, signer: args.authority },
      { address: await configAddress(programId), role: AccountRole.READONLY },
      { address: await epochAddress(args.year, programId), role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: data("open_epoch", u16le(args.year), bytes32("methodologyImageId", args.methodologyImageId)),
  } as Instruction;
}

/**
 * Records `year`'s result from a VAA already posted to the Wormhole core bridge (post it with
 * Wormhole's SDK first). Anyone may send it; the transaction's fee payer signs.
 */
export async function receiveResultInstruction(args: {
  year: number;
  postedVaa: Address;
  programId?: Address;
}): Promise<Instruction> {
  const programId = args.programId ?? PROGRAM_ID;
  return {
    programAddress: programId,
    accounts: [
      { address: await configAddress(programId), role: AccountRole.READONLY },
      { address: await epochAddress(args.year, programId), role: AccountRole.WRITABLE },
      { address: args.postedVaa, role: AccountRole.READONLY },
    ],
    data: data("receive_result"),
  } as Instruction;
}

/** Voids `year` if it has no result by the deadline. Anyone may send it. */
export async function voidEpochInstruction(args: { year: number; programId?: Address }): Promise<Instruction> {
  const programId = args.programId ?? PROGRAM_ID;
  return {
    programAddress: programId,
    accounts: [{ address: await epochAddress(args.year, programId), role: AccountRole.WRITABLE }],
    data: data("void_epoch"),
  } as Instruction;
}

class Reader {
  private offset = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  take(n: number): Uint8Array {
    if (this.offset + n > this.bytes.length) throw new Error("account data too short");
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  u8 = () => this.take(1)[0];
  u16 = () => this.view.getUint16(this.take(2).byteOffset - this.bytes.byteOffset, true);
  u64 = () => this.view.getBigUint64(this.take(8).byteOffset - this.bytes.byteOffset, true);
  i64 = () => this.view.getBigInt64(this.take(8).byteOffset - this.bytes.byteOffset, true);
  hex32 = () => bytesToHex(this.take(32));
}

function expectDiscriminator(r: Reader, name: string) {
  const got = r.take(8);
  if (!discriminator("account", name).every((b, i) => b === got[i])) throw new Error(`not a ${name} account`);
}

const STATUSES: EpochStatus[] = ["open", "settled", "voided"];

export function decodeEpoch(accountData: Uint8Array): SolanaEpoch {
  const r = new Reader(accountData);
  expectDiscriminator(r, "Epoch");
  const year = r.u16();
  const cutoff = r.i64();
  const methodologyImageId = r.hex32();
  const status = STATUSES[r.u8()];
  if (!status) throw new Error("unknown epoch status");
  const result = r.u8()
    ? { evidenceRoot: r.hex32(), methodologyImageId: r.hex32(), outputHash: r.hex32(), resolutionUriHash: r.hex32() }
    : null;
  return { year, cutoff, methodologyImageId, status, result, assertionId: r.hex32(), wormholeSequence: r.u64(), bump: r.u8() };
}

export function decodeConfig(accountData: Uint8Array): SolanaConfig {
  const r = new Reader(accountData);
  expectDiscriminator(r, "Config");
  const decodeAddress = (b: Uint8Array) => getAddressDecoder().decode(b);
  return {
    authority: decodeAddress(r.take(32)),
    wormholeProgram: decodeAddress(r.take(32)),
    emitterChain: r.u16(),
    emitterAddress: r.hex32(),
    bump: r.u8(),
  };
}

