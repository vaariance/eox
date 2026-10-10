import { type ChildProcess, spawn, spawnSync } from "node:child_process";

import {
  type KeyDirectoryEntry,
  type RemoteSigner,
  type SignEvmTransactionRequest,
  type SignResult,
  SIGNING_SCHEMA_VERSION,
  validateSignRequest,
} from "@eox/signing";
import { type Hex, type PublicClient, createPublicClient, createTestClient, http, parseEther, parseTransaction } from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { remoteSender } from "../src/remote-sender.js";

const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;
const kms = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const other = privateKeyToAccount("0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e");
const recipient = "0x00000000000000000000000000000000000000aa";
const KEY_VERSION = "projects/test/locations/x/keyRings/y/cryptoKeys/evm-relayer/cryptoKeyVersions/1";

type Request = Omit<SignEvmTransactionRequest, "chain">;

function fakeSigner(options: { network?: string; signWith?: PrivateKeyAccount; reject?: boolean; alter?: boolean } = {}) {
  const requests: Request[] = [];
  const entry: KeyDirectoryEntry = {
    role: "evm-relayer",
    environment: "dev",
    chain: "evm",
    network: options.network ?? `eip155:${foundry.id}`,
    algorithm: "secp256k1",
    publicKey: kms.publicKey,
    address: kms.address,
    keyVersion: KEY_VERSION,
    state: "active",
    validFrom: 0,
    validUntil: null,
  };
  const signer: RemoteSigner = {
    getPublicKey: async () => entry,
    keyDirectory: async () => ({ schemaVersion: SIGNING_SCHEMA_VERSION, environment: "dev", version: 1, generatedAt: 0, entries: [entry] }),
    signSolanaTransaction: async () => {
      throw new Error("not used");
    },
    signEvmTransaction: async (request): Promise<SignResult> => {
      validateSignRequest({ ...request, chain: "evm" }, Math.floor(Date.now() / 1000));
      requests.push(request);
      const base = { schemaVersion: SIGNING_SCHEMA_VERSION, requestId: request.requestId, decidedAt: 0 } as const;
      if (options.reject) {
        return { ...base, decision: "rejected", payloadSha256: null, code: "TARGET_NOT_BOUND", reason: "adapter is not bound" };
      }
      const transaction = parseTransaction(request.unsignedTransactionHex as Hex);
      const signedTransaction = await (options.signWith ?? kms).signTransaction(
        options.alter ? { ...transaction, value: (transaction.value ?? 0n) + 1n } : transaction,
      );
      return {
        ...base,
        decision: "signed",
        payloadSha256: "00",
        signer: { role: "evm-relayer", address: kms.address, keyVersion: KEY_VERSION },
        signature: "0x",
        signedTransaction,
      };
    },
  };
  return { signer, requests };
}

describe.skipIf(!hasAnvil)("remote sender on Anvil", () => {
  const port = 10545 + Math.floor(Math.random() * 1000);
  const transport = http(`http://127.0.0.1:${port}`);
  const client = createPublicClient({ chain: foundry, transport }) as PublicClient;
  const test = createTestClient({ chain: foundry, transport, mode: "anvil" });
  let anvil: ChildProcess;

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
    for (let i = 0; i < 100; i++) {
      try {
        await client.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await test.setBalance({ address: kms.address, value: parseEther("1") });
  }, 30_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("signs an EIP-1559 transaction through the signer and broadcasts it", async () => {
    const { signer, requests } = fakeSigner();
    const sender = await remoteSender({ client, signer, role: "evm-relayer" });
    expect(sender.address).toBe(kms.address);

    const hash = await sender.send({ to: recipient, data: "0x", value: 5n }, { id: "publish:0xabc:1", kind: "publish" });
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    expect(receipt.from.toLowerCase()).toBe(kms.address.toLowerCase());
    expect(await client.getBalance({ address: recipient })).toBe(5n);

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request).toMatchObject({
      role: "evm-relayer",
      keyVersion: KEY_VERSION,
      network: `eip155:${foundry.id}`,
      operation: { operationId: "publish:0xabc:1", kind: "publish" },
    });
    expect(request.requestId).toMatch(/^uma-relay:[0-9a-f]{40}$/);
    const unsigned = parseTransaction(request.unsignedTransactionHex as Hex);
    expect(unsigned).toMatchObject({ type: "eip1559", chainId: foundry.id, to: recipient, value: 5n, nonce: 0 });
    expect(unsigned.accessList).toBeUndefined();
  });

  it("uses a new request for each transaction and the next nonce", async () => {
    const { signer, requests } = fakeSigner();
    const sender = await remoteSender({ client, signer, role: "evm-relayer" });
    const operation = { id: "settle:0x01", kind: "settle" } as const;
    await client.waitForTransactionReceipt({ hash: await sender.send({ to: recipient, data: "0x" }, operation) });
    await client.waitForTransactionReceipt({ hash: await sender.send({ to: recipient, data: "0x" }, operation) });
    expect(requests[0]!.requestId).not.toBe(requests[1]!.requestId);
    const nonces = requests.map((request) => parseTransaction(request.unsignedTransactionHex as Hex).nonce);
    expect(nonces[1]).toBe(nonces[0]! + 1);
  });

  it("surfaces a signer rejection without broadcasting", async () => {
    const before = await client.getTransactionCount({ address: kms.address });
    const sender = await remoteSender({ client, signer: fakeSigner({ reject: true }).signer, role: "evm-relayer" });
    await expect(sender.send({ to: recipient, data: "0x" }, { id: "close:0x02", kind: "close" })).rejects.toThrow(
      "TARGET_NOT_BOUND: adapter is not bound",
    );
    expect(await client.getTransactionCount({ address: kms.address })).toBe(before);
  });

  it("refuses a signature from another key or over another transaction", async () => {
    const operation = { id: "close:0x03", kind: "close" } as const;
    const wrongKey = await remoteSender({ client, signer: fakeSigner({ signWith: other }).signer, role: "evm-relayer" });
    await expect(wrongKey.send({ to: recipient, data: "0x" }, operation)).rejects.toThrow("signature from another key");
    const altered = await remoteSender({ client, signer: fakeSigner({ alter: true }).signer, role: "evm-relayer" });
    await expect(altered.send({ to: recipient, data: "0x" }, operation)).rejects.toThrow("different transaction");
  });

  it("refuses a key registered for another network", async () => {
    const { signer } = fakeSigner({ network: "eip155:11155111" });
    await expect(remoteSender({ client, signer, role: "evm-relayer" })).rejects.toThrow(
      `evm-relayer key is for eip155:11155111, not eip155:${foundry.id}`,
    );
  });
});
