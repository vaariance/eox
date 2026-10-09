import anchor, { type Idl } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import { ReferenceReader } from "../src/references.js";

const rpc = process.argv[2];
if (!rpc) throw new Error("Usage: tsx examples/read-reference.ts <RPC URL> [snapshot address]");
const idl = JSON.parse(await readFile(new URL("../../../packages/oracle/idl/eox_oracle.json", import.meta.url), "utf8")) as Idl;
const program = new anchor.Program(idl, { connection: new Connection(rpc, "finalized") });
const reader = new ReferenceReader(program);
const snapshot = await reader.readSnapshot(process.argv[3]);
process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
