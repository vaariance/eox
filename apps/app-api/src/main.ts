import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FixtureReferenceSource } from "./fixture-source.js";
import { createAppApiServer } from "./server.js";

const mode = process.env.APP_API_SOURCE ?? "fixture";
if (mode !== "fixture") throw new Error(`unsupported APP_API_SOURCE: ${mode}; only "fixture" is available until the live source exists`);

const host = process.env.APP_API_HOST ?? "127.0.0.1";
const port = Number(process.env.APP_API_PORT ?? "8790");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid APP_API_PORT: ${port}`);

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const source = new FixtureReferenceSource(
  join(fixtures, "oracle-preview.json"),
  join(fixtures, "timeline.json"),
  Math.floor(Date.now() / 1000),
);
const server = createAppApiServer({ source, onError: (error) => console.error("app-api request failed", error) });
server.listen(port, host, () => console.log(`app-api (fixture) listening on http://${host}:${port}`));

function shutdown(): void {
  server.close(() => process.exit(0));
  server.closeAllConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
