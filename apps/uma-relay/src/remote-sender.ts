import type { RemoteSigner, SigningRole } from "@eox/signing";
import {
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionSerializableEIP1559,
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
} from "viem";

import type { Operation, Sender, Transaction } from "./relay.js";

export interface RemoteSenderOptions {
  client: PublicClient;
  signer: RemoteSigner;
  role: SigningRole;
  gasMarginPercent?: bigint;
  requestSeconds?: number;
  now?(): number;
}

export async function remoteSender(options: RemoteSenderOptions): Promise<Sender> {
  const { client, signer, role } = options;
  const chainId = await client.getChainId();
  const key = await signer.getPublicKey(role);
  if (key.network !== `eip155:${chainId}`) {
    throw new Error(`${role} key is for ${key.network}, not eip155:${chainId}`);
  }
  const address = getAddress(key.address);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const margin = options.gasMarginPercent ?? 20n;

  async function send(transaction: Transaction, operation: Operation): Promise<Hash> {
    const [nonce, gas, fees] = await Promise.all([
      client.getTransactionCount({ address, blockTag: "pending" }),
      client.estimateGas({ account: address, ...transaction }),
      client.estimateFeesPerGas(),
    ]);
    const unsigned: TransactionSerializableEIP1559 = {
      type: "eip1559",
      chainId,
      nonce,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value ?? 0n,
      gas: (gas * (100n + margin)) / 100n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
    const unsignedTransactionHex = serializeTransaction(unsigned);
    const result = await signer.signEvmTransaction({
      requestId: `uma-relay:${keccak256(unsignedTransactionHex).slice(2, 42)}`,
      role,
      keyVersion: key.keyVersion,
      network: key.network,
      operation: { operationId: operation.id, kind: operation.kind },
      expiresAt: now() + (options.requestSeconds ?? 120),
      unsignedTransactionHex,
    });
    if (result.decision === "rejected") throw new Error(`${result.code}: ${result.reason}`);

    const signed = result.signedTransaction as Hex;
    await assertSigned(signed, unsignedTransactionHex, address);
    return client.sendRawTransaction({ serializedTransaction: signed });
  }

  return { address, send };
}

async function assertSigned(signed: Hex, unsigned: Hex, address: Address): Promise<void> {
  const parsed = parseTransaction(signed) as TransactionSerializableEIP1559 & Record<string, unknown>;
  const body = Object.fromEntries(
    Object.entries(parsed).filter(([field]) => !["r", "s", "v", "yParity"].includes(field)),
  ) as TransactionSerializableEIP1559;
  if (serializeTransaction(body) !== unsigned) throw new Error("signer returned a different transaction");
  const recovered = await recoverTransactionAddress({ serializedTransaction: signed as `0x02${string}` });
  if (recovered !== address) throw new Error("signer returned a signature from another key");
}
