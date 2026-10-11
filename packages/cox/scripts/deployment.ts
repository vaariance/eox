import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

interface DeploymentConfig {
  programId: string;
  admin: string;
  upgradeAuthority: string;
  rpc: string;
  genesisHash: string;
  sbfRustVersion: string;
  sbfToolsVersion: string;
  platformToolsVersion: string;
}

interface ReviewedBuild {
  programId: string;
  commit: string;
  sources: Record<string, string>;
  idlSha256: string;
  sbfBuildSha256: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cox = join(root, "packages/cox");
const local = join(root, ".cox");

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function sources(): Record<string, string> {
  const paths: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "target") visit(path);
      else if (entry.isFile() && [".rs", ".toml", ".lock"].includes(extname(path))) paths.push(path);
    }
  }
  visit(cox);
  return Object.fromEntries(paths.sort().map(path => [relative(root, path), sha(readFileSync(path))]));
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "solana-bin": { type: "string" },
      "platform-tools": { type: "string" },
      "approved-commit": { type: "string" },
    },
  });
  const [action] = positionals;
  if (positionals.length !== 1 || !["build", "deploy", "verify"].includes(action ?? "")
      || !values["solana-bin"] || !values["platform-tools"]) {
    throw new Error("Usage: node packages/cox/scripts/deployment.ts build|deploy|verify --solana-bin PATH --platform-tools PATH [--approved-commit SHA]");
  }
  const solanaBin = resolve(values["solana-bin"]);
  const platform = resolve(values["platform-tools"]);
  const solana = join(solanaBin, "solana");
  const settings = readJson<DeploymentConfig>(join(cox, "deploy/devnet.json"));
  const compiler = join(platform, "rust/bin/rustc");
  const compilerVersion = run(compiler, ["--version"]);
  if (compilerVersion !== settings.sbfRustVersion && !compilerVersion.startsWith(settings.sbfRustVersion + " ")) {
    throw new Error("SBF compiler differs from the pinned release");
  }
  const program = join(cox, "target/deploy/cox.so");
  const report = join(local, "reviewed-build.json");
  const idl = join(cox, "idl/cox.json");
  if (readJson<{ address: string }>(idl).address !== settings.programId) {
    throw new Error("Generated IDL address does not match deployment identity");
  }
  if (action === "build") {
    const tool = join(solanaBin, "cargo-build-sbf");
    const version = run(tool, ["--version"]);
    if (!version.startsWith("solana-cargo-build-sbf " + settings.sbfToolsVersion + "\n")) {
      throw new Error("SBF tool version differs from the pinned configuration");
    }
    const before = sources();
    execFileSync(tool, [
      "--manifest-path", join(cox, "programs/cox/Cargo.toml"),
      "--sbf-out-dir", dirname(program), "--tools-version", settings.platformToolsVersion,
      "--skip-tools-install", "--no-rustup-override", "--", "--locked",
    ], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, RUSTC: compiler,
        PATH: [join(platform, "rust/bin"), solanaBin, process.env.PATH ?? ""].join(delimiter) },
    });
    if (!isDeepStrictEqual(before, sources())) throw new Error("Source changed during build; rerun after edits stop");
    writeJson(report, {
      schema: "cox.reviewed-build/v1",
      programId: settings.programId,
      commit: run("git", ["rev-parse", "HEAD"]),
      sources: sources(),
      idlSha256: sha(readFileSync(idl)),
      sbfBuildSha256: sha(readFileSync(program)),
      sbfBytes: statSync(program).size,
      toolVersion: version,
      sbfCompilerVersion: compilerVersion,
      sbfCompilerSha256: sha(readFileSync(compiler)),
      livePoolActive: false,
    });
    console.log(report);
    return;
  }
  if (run(solana, ["--url", settings.rpc, "genesis-hash"]) !== settings.genesisHash) {
    throw new Error("RPC is not the pinned devnet");
  }
  const built = readJson<ReviewedBuild>(report);
  if (!isDeepStrictEqual(built.sources, sources()) || built.sbfBuildSha256 !== sha(readFileSync(program))
      || built.idlSha256 !== sha(readFileSync(idl)) || built.programId !== settings.programId) {
    throw new Error("Source or binary changed after reviewed build; rebuild and review");
  }
  if (action === "deploy") {
    if (!values["approved-commit"]) throw new Error("Explicit approved commit is required by repository workflow");
    const head = run("git", ["rev-parse", "HEAD"]);
    if (head !== values["approved-commit"] || head !== built.commit) {
      throw new Error("Approval and reviewed build must identify current HEAD");
    }
    if (run("git", ["status", "--porcelain", "--untracked-files=all", "--", "packages/cox"])) {
      throw new Error("COX source and handoff files must be committed before deployment");
    }
    const keys = join(local, "keys");
    const identities = [["cox-program", settings.programId], ["cox-admin", settings.admin],
      ["cox-upgrade", settings.upgradeAuthority]] as const;
    for (const [name, expected] of identities) {
      const key = join(keys, name + "-keypair.json");
      if (statSync(key).mode & 0o077) throw new Error("Local deployment keys must not be readable by other users");
      if (run(join(solanaBin, "solana-keygen"), ["pubkey", key]) !== expected) {
        throw new Error("Deployment key does not match configured public identity");
      }
    }
    const result = run(solana, [
      "--url", settings.rpc, "--keypair", join(keys, "cox-admin-keypair.json"),
      "--output", "json", "program", "deploy", program,
      "--program-id", join(keys, "cox-program-keypair.json"),
      "--upgrade-authority", join(keys, "cox-upgrade-keypair.json"),
    ]);
    writeJson(join(local, "deployment-response.json"), JSON.parse(result));
  }
  const dumped = join(local, "deployed-program.so");
  run(solana, ["--url", settings.rpc, "program", "dump", settings.programId, dumped]);
  const bytes = readFileSync(program);
  const deployed = readFileSync(dumped);
  if (!deployed.subarray(0, bytes.length).equals(bytes) || deployed.subarray(bytes.length).some(byte => byte !== 0)) {
    throw new Error("Deployed program differs from the reviewed binary");
  }
  const info = JSON.parse(run(solana, ["--url", settings.rpc, "--output", "json", "program", "show", settings.programId])) as { authority?: string };
  if (info.authority !== settings.upgradeAuthority) throw new Error("Unexpected upgrade authority");
  writeJson(join(cox, "deploy/deployed-devnet.json"), {
    ...settings,
    status: "deployed-program-live-pool-inactive",
    deployedCommit: built.commit,
    deployedBuildSha256: sha(bytes),
    deployedDumpSha256: sha(deployed),
    programAccount: info,
    deploymentResponse: readJson<unknown>(join(local, "deployment-response.json")),
  });
  console.log("Verified deployed binary and separate upgrade authority; live pool remains inactive");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
