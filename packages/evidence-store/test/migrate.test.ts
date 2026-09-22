import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const testUrl = "postgres://eox:eox@localhost:5433/eox_test";

describe("migration runner", () => {
  it("does not reapply an already-applied migration", () => {
    const output = execFileSync(process.execPath, [tsxCli, "src/migrate.ts"], {
      cwd: packageRoot,
      env: { ...process.env, DATABASE_URL: testUrl },
      encoding: "utf8",
    });

    expect(output).toContain("migrations up to date");
    expect(output).not.toContain("applied 001_init.sql");
  });
});
