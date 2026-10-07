import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileMethodology, type MethodologyPolicy } from "./index.js";

const args = process.argv.slice(2);
if (args.length !== 5 || args[0] !== "compile" || args[1] !== "--policy" || args[3] !== "--out") {
  throw new Error("Usage: methodology compile --policy PATH --out DIRECTORY");
}
const input = JSON.parse(await readFile(resolve(args[2]!), "utf8")) as MethodologyPolicy;
const result = compileMethodology(input);
const output = resolve(args[4]!);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "configuration.json"), `${JSON.stringify(result.configuration, null, 2)}\n`);
await writeFile(resolve(output, "manifest.json"), result.canonicalManifest);
await writeFile(resolve(output, "manifest.sha256"), `${result.manifestDigest}\n`);
console.log(result.manifestDigest);
