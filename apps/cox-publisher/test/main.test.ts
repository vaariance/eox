import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

test("disabled CLI exits cleanly without initializing signer, RPC or process lock", async () => {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const { stdout, stderr } = await run(process.execPath, [...process.execArgv, main, "--once"], { cwd, timeout: 10000 });
  assert.deepEqual(JSON.parse(stdout.trim()), { event: "disabled", livePublishing: false });
  assert.equal(stderr, "");
});
