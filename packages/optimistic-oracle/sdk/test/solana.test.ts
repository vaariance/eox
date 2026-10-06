import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type Address,
  type Instruction,
  type KeyPairSigner,
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { type Hex, bytesToHex, hexToBytes } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import {
  PROGRAM_ID,
  RESULT_DEADLINE_SECONDS,
  WORMHOLE_CHAIN,
  configAddress,
  cutoffTimestamp,
  decodeConfig,
  decodeEpoch,
  discriminator,
  epochAddress,
  evmEmitterAddress,
  initializeInstruction,
  openEpochInstruction,
  receiveResultInstruction,
  voidEpochInstruction,
} from "../src/index.js";
import { GOLDEN_PAYLOAD, word } from "./golden.js";

const hex = (b: Uint8Array) => bytesToHex(b).slice(2);

// The same values the program's `sdk_vectors` tests pin.
describe("program interface", () => {
  it("uses the program's instruction and account discriminators", () => {
    expect(hex(discriminator("global", "initialize"))).toBe("afaf6d1f0d989bed");
    expect(hex(discriminator("global", "open_epoch"))).toBe("4b39da21adfecf88");
    expect(hex(discriminator("global", "receive_result"))).toBe("9372879a47abe718");
    expect(hex(discriminator("global", "void_epoch"))).toBe("5449e5c9e02429cb");
    expect(hex(discriminator("account", "Epoch"))).toBe("5d537859978a986c");
    expect(hex(discriminator("account", "Config"))).toBe("9b0caae01efacc82");
  });

  it("derives the program's addresses", async () => {
    expect(await configAddress()).toBe("JDVQSVB61491BcXBGDZ5NjDd7pwNBNnveeHC49jXiwe2");
    expect(await epochAddress(2025)).toBe("5rRNd32H52xpM8FMFcc5xsqi9gYWK73whGPdnijkfZQK");
  });

  it("decodes epoch accounts", () => {
    const settled = hexToBytes(
      `0x5d537859978a986ce90780e56b6a00000000${"22".repeat(32)}0101${"11".repeat(32)}${"22".repeat(32)}` +
        `${"33".repeat(32)}${"44".repeat(32)}${"55".repeat(32)}1100000000000000ff` as Hex,
    );
    expect(decodeEpoch(settled)).toEqual({
      year: 2025,
      cutoff: BigInt(cutoffTimestamp(2025)),
      methodologyImageId: `0x${"22".repeat(32)}`,
      status: "settled",
      result: {
        evidenceRoot: `0x${"11".repeat(32)}`,
        methodologyImageId: `0x${"22".repeat(32)}`,
        outputHash: `0x${"33".repeat(32)}`,
        resolutionUriHash: `0x${"44".repeat(32)}`,
      },
      assertionId: `0x${"55".repeat(32)}`,
      wormholeSequence: 17n,
      bump: 255,
    });

    const open = hexToBytes(`0x5d537859978a986cea0700194d6c00000000${"22".repeat(32)}0000${"00".repeat(32)}0000000000000000fe`);
    expect(decodeEpoch(open)).toMatchObject({ year: 2026, status: "open", result: null, wormholeSequence: 0n, bump: 254 });
    expect(() => decodeEpoch(open.subarray(0, 20))).toThrow();
  });

  it("pads EVM addresses into Wormhole emitters", () => {
    expect(evmEmitterAddress("0x00000000000000000000000000000000000000Ad")).toBe(word("ad"));
  });
});

// Runs the SDK's instructions against the compiled program. Build it first:
//   cargo build-sbf --arch v0 --manifest-path programs/eox_settlement_oracle/Cargo.toml
const PROGRAM_SO = fileURLToPath(
  new URL("../../solana/target/deploy/eox_settlement_oracle.so", import.meta.url),
);

const YEAR = 2025;
const IMAGE_ID = word("2222");
const EMITTER = evmEmitterAddress("0xadadadadadadadadadadadadadadadadadadadad");

describe.skipIf(!existsSync(PROGRAM_SO))("against the compiled program (LiteSVM)", () => {
  let svm: LiteSVM;
  let authority: KeyPairSigner;
  let wormhole: Address;

  async function send(signer: KeyPairSigner, instruction: Instruction) {
    svm.expireBlockhash();
    const tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
      (m) => appendTransactionMessageInstruction(instruction, m),
      (m) => signTransactionMessageWithSigners(m),
    );
    return svm.sendTransaction(tx);
  }

  async function ok(signer: KeyPairSigner, instruction: Instruction) {
    const result = await send(signer, instruction);
    if (result instanceof FailedTransactionMetadata) {
      throw new Error(`transaction failed: ${result.err()}\n${result.meta().logs().join("\n")}`);
    }
  }

  async function fails(signer: KeyPairSigner, instruction: Instruction, code: number) {
    const result = await send(signer, instruction);
    expect(result).toBeInstanceOf(FailedTransactionMetadata);
    expect(String((result as FailedTransactionMetadata).err())).toContain(`${code}`);
  }

  function setTime(unixTimestamp: number) {
    const clock = svm.getClock();
    clock.unixTimestamp = BigInt(unixTimestamp);
    svm.setClock(clock);
  }

  /** LiteSVM deploys without an upgrade authority; write one in as a real deploy would. */
  async function setUpgradeAuthority(key: Address) {
    const [programData] = await getProgramDerivedAddress({
      programAddress: address("BPFLoaderUpgradeab1e11111111111111111111111"),
      seeds: [getAddressEncoder().encode(PROGRAM_ID)],
    });
    const account = svm.getAccount(programData);
    if (!account.exists) throw new Error("program data account missing");
    const data = new Uint8Array(account.data);
    data[12] = 1;
    data.set(getAddressEncoder().encode(key), 13);
    svm.setAccount({ ...account, data });
  }

  function postVaa(magic: string, chain: number, emitter: string, payload: Uint8Array, owner = wormhole): Address {
    // The core bridge's layout: magic, then Borsh MessageData with little-endian integers.
    const data = new Uint8Array(95 + payload.length);
    const view = new DataView(data.buffer);
    let at = 0;
    const put = (bytes: Uint8Array) => (data.set(bytes, at), (at += bytes.length));
    put(new TextEncoder().encode(magic));
    put(new Uint8Array([1, 1])); // vaa_version, consistency_level
    put(new Uint8Array(4 + 32 + 4 + 4)); // vaa_time, vaa_signature_account, submission_time, nonce
    view.setBigUint64(at, 9n, true), (at += 8); // sequence
    view.setUint16(at, chain, true), (at += 2);
    put(hexToBytes(emitter as `0x${string}`));
    view.setUint32(at, payload.length, true), (at += 4);
    put(payload);
    const account = address(randomAddress());
    svm.setAccount({ address: account, data, executable: false, lamports: lamports(1_000_000_000n), programAddress: owner, space: BigInt(data.length) });
    return account;
  }

  let counter = 0;
  function randomAddress(): string {
    // Any 32 bytes are a valid account address; base58 of a counter-based key is enough here.
    const bytes = new Uint8Array(32);
    bytes[0] = 7;
    new DataView(bytes.buffer).setUint32(28, ++counter);
    return getAddressDecoder().decode(bytes);
  }

  beforeEach(async () => {
    svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, PROGRAM_SO);
    authority = await generateKeyPairSigner();
    svm.airdrop(authority.address, lamports(10_000_000_000n));
    await setUpgradeAuthority(authority.address);
    wormhole = (await generateKeyPairSigner()).address;

    await ok(
      authority,
      await initializeInstruction({ authority, wormholeProgram: wormhole, emitterChain: WORMHOLE_CHAIN.base, emitterAddress: EMITTER }),
    );
    await ok(authority, await openEpochInstruction({ authority, year: YEAR, methodologyImageId: IMAGE_ID }));
  });

  function readEpoch(year = YEAR) {
    return epochAddress(year).then((a) => {
      const account = svm.getAccount(a);
      if (!account.exists) throw new Error("epoch missing");
      return decodeEpoch(new Uint8Array(account.data));
    });
  }

  it("initializes and opens an epoch", async () => {
    const config = svm.getAccount(await configAddress());
    if (!config.exists) throw new Error("config missing");
    expect(decodeConfig(new Uint8Array(config.data))).toMatchObject({
      authority: authority.address,
      wormholeProgram: wormhole,
      emitterChain: WORMHOLE_CHAIN.base,
      emitterAddress: EMITTER,
    });
    expect(await readEpoch()).toMatchObject({ year: YEAR, status: "open", methodologyImageId: IMAGE_ID, result: null });
  });

  it("records a relayed result", async () => {
    setTime(cutoffTimestamp(YEAR) + 4 * 86_400);
    const vaa = postVaa("vaa", WORMHOLE_CHAIN.base, EMITTER, hexToBytes(GOLDEN_PAYLOAD));
    const payer = await generateKeyPairSigner();
    svm.airdrop(payer.address, lamports(1_000_000_000n));
    await ok(payer, await receiveResultInstruction({ year: YEAR, postedVaa: vaa }));

    const epoch = await readEpoch();
    expect(epoch.status).toBe("settled");
    expect(epoch.result?.outputHash).toBe(word("3333"));
    expect(epoch.assertionId).toBe(word("b10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6"));
    expect(epoch.wormholeSequence).toBe(9n);
  });

  it("refuses a VAA from another emitter", async () => {
    setTime(cutoffTimestamp(YEAR) + 4 * 86_400);
    const vaa = postVaa("vaa", WORMHOLE_CHAIN.base, word("beef"), hexToBytes(GOLDEN_PAYLOAD));
    await fails(authority, await receiveResultInstruction({ year: YEAR, postedVaa: vaa }), 6007); // UnknownEmitter
    expect((await readEpoch()).status).toBe("open");
  });

  it("voids an epoch with no result after the deadline", async () => {
    setTime(cutoffTimestamp(YEAR) + RESULT_DEADLINE_SECONDS);
    await fails(authority, await voidEpochInstruction({ year: YEAR }), 6005); // DeadlineNotReached
    setTime(cutoffTimestamp(YEAR) + RESULT_DEADLINE_SECONDS + 1);
    await ok(authority, await voidEpochInstruction({ year: YEAR }));
    expect((await readEpoch()).status).toBe("voided");
  });
});

