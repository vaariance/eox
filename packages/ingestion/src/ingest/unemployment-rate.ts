import { pool } from "@eox/evidence-store";
import { unemploymentMonthlyRoutes, unemploymentQuarterlyRoutes } from "../indicators/unemployment-rate.js";
import { ingestOecdSnapshot } from "../ingest-oecd-snapshot.js";

await ingestOecdSnapshot(
  {
    indicatorId: "unemployment_rate",
    monthlyRoutes: unemploymentMonthlyRoutes,
    quarterlyRoutes: unemploymentQuarterlyRoutes,
  },
  process.argv[2] ?? "2021",
);

await pool.end();
