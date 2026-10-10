import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CoxFixtureSource } from "./cox/fixture-source.js";
import { createCoxApiServer } from "./cox/server.js";

const mode = process.env.APP_API_SOURCE ?? "cox-fixture";
if (mode !== "cox-fixture") throw new Error(`unsupported APP_API_SOURCE: ${mode}; the live COX source waits for the P3 program`);
const host = process.env.APP_API_HOST ?? "127.0.0.1";
const port = Number(process.env.APP_API_PORT ?? "8790");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid APP_API_PORT: ${port}`);

const fixture = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "cox-fixture.json");
const server = createCoxApiServer({ source: new CoxFixtureSource(fixture), onError: (error) => console.error("app-api request failed", error) });
server.listen(port, host, () => console.log(`app-api (${mode}) listening on http://${host}:${port}`));

function shutdown(): void {
  server.close(() => process.exit(0));
  server.closeAllConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
