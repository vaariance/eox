import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createPublicClient, http, recoverTransactionAddress, serializeTransaction, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { loadSignerConfig } from "../src/config.js";
import { resolveKeys } from "../src/directory.js";
import { signEvmTransaction } from "../src/evm.js";
import { signSolanaTransaction } from "../src/solana.js";

const [configPath] = process.argv.slice(2);
const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
const solanaRpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const evmRpc = process.env.EVM_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
if (!configPath || !accessToken) {
  console.error("usage: GOOGLE_ACCESS_TOKEN=<token for eox-signer> prove-adapters <config.json>");
  process.exit(2);
}
const token = async () => accessToken;
const keys = await resolveKeys(loadSignerConfig(configPath), token);
const config = loadSignerConfig(configPath);

const operator = keys.get("oracle-operator")!;
const connection = new Connection(solanaRpc, "confirmed");
const payer = new PublicKey(operator.derived.rawPublicKey);
let balance = await connection.getBalance(payer);
if (balance < 0.01 * LAMPORTS_PER_SOL) {
  try {
    const airdrop = await connection.requestAirdrop(payer, 0.1 * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: airdrop, ...latest }, "confirmed");
    balance = await connection.getBalance(payer);
  } catch (error) {
    console.log(`solana: devnet airdrop unavailable (${error instanceof Error ? error.message : String(error)})`);
  }
}
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
const message = new TransactionMessage({
  payerKey: payer,
  recentBlockhash: blockhash,
  instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 })],
}).compileToV0Message();
const unsigned = Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
const solana = await signSolanaTransaction(token, operator.entry.keyVersion, operator.derived.rawPublicKey, unsigned);
const signedSolana = VersionedTransaction.deserialize(Buffer.from(solana.signedTransaction, "base64"));
const simulation = await connection.simulateTransaction(signedSolana, { sigVerify: true });
const simulationError = JSON.stringify(simulation.value.err);
if (simulationError.includes("SignatureFailure")) throw new Error("devnet rejected the KMS signature");
console.log(`solana: devnet signature verification passed (simulation result: ${simulationError})`);
if (balance >= 0.01 * LAMPORTS_PER_SOL) {
  const solanaSignature = await connection.sendRawTransaction(Buffer.from(solana.signedTransaction, "base64"));
  await connection.confirmTransaction({ signature: solanaSignature, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`solana: ${operator.entry.address} devnet transaction ${solanaSignature} confirmed`);
} else {
  console.log(`solana: ${operator.entry.address} is unfunded; transaction not broadcast`);
}

const asserter = keys.get("uma-asserter")!;
const client = createPublicClient({ chain: sepolia, transport: http(evmRpc) });
const address = asserter.entry.address as Hex;
const fees = await client.estimateFeesPerGas();
const unsignedEvm = serializeTransaction({
  type: "eip1559",
  chainId: sepolia.id,
  nonce: await client.getTransactionCount({ address }),
  to: address,
  value: 0n,
  gas: 21_000n,
  maxFeePerGas: fees.maxFeePerGas,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
});
const evm = await signEvmTransaction(token, asserter.entry.keyVersion, address, unsignedEvm);
const recovered = await recoverTransactionAddress({ serializedTransaction: evm.signedTransaction as `0x02${string}` });
if (recovered !== address) throw new Error(`local recovery returned ${recovered}, expected ${address}`);
console.log(`evm: signed Sepolia transaction recovers locally to ${recovered}`);
const rpcResponse = (await (
  await fetch(evmRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [evm.signedTransaction] }),
  })
).json()) as { result?: string; error?: { message: string } };
if (rpcResponse.result) {
  console.log(`evm: Sepolia accepted transaction ${rpcResponse.result}`);
} else {
  const text = rpcResponse.error?.message ?? "no error message";
  if (!/insufficient funds/i.test(text)) throw new Error(`Sepolia rejected the transaction: ${text}`);
  console.log(`evm: ${address} is unfunded; Sepolia broadcast pending funding (node: ${text})`);
}
console.log(`environment ${config.environment}: signatures verified; broadcasts need funded accounts`);
