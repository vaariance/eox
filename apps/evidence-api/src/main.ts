import { pool } from "@eox/evidence-store";
import { createEvidenceServer } from "./server.js";

const host = process.env.EVIDENCE_API_HOST ?? "127.0.0.1";
const port = Number(process.env.EVIDENCE_API_PORT ?? "8787");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid EVIDENCE_API_PORT: ${port}`);

const server = createEvidenceServer((error) => console.error("evidence-api request failed", error));
server.listen(port, host, () => console.log(`evidence-api listening on http://${host}:${port}`));

function shutdown(): void {
  server.close(() => {
    pool.end().then(() => process.exit(0), () => process.exit(1));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
