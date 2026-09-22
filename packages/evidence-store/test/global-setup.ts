import pg from "pg";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const adminUrl = "postgres://eox:eox@localhost:5433/eox";
const testUrl = "postgres://eox:eox@localhost:5433/eox_test";

export default async function setup() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'eox_test' AND pid <> pg_backend_pid()",
  );
  await admin.query("DROP DATABASE IF EXISTS eox_test");
  await admin.query("CREATE DATABASE eox_test");
  await admin.end();

  execFileSync(process.execPath, [tsxCli, "src/migrate.ts"], {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "inherit",
  });
}
