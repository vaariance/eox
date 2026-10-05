import { pool } from "@eox/evidence-store";
import { coreCpiMonthlyRoutes, coreCpiQuarterlyRoutes } from "../indicators/core-cpi.js";
import { ingestOecdSnapshot } from "../ingest-oecd-snapshot.js";

await ingestOecdSnapshot(
  { indicatorId: "cpi_core_yoy", monthlyRoutes: coreCpiMonthlyRoutes, quarterlyRoutes: coreCpiQuarterlyRoutes },
  process.argv[2] ?? "2021",
);

await pool.end();
