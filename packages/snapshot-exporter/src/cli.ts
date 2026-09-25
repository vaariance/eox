import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { getAsOf, pool } from "@eox/evidence-store";
import { exportSnapshot, type OfficialSources } from "./export.js";

const { values } = parseArgs({
  options: {
    "as-of": { type: "string" },
    "period-start": { type: "string" },
    "period-end": { type: "string" },
    sources: { type: "string" },
    out: { type: "string" },
  },
});

const asOf = values["as-of"];
const periodStart = values["period-start"];
const periodEnd = values["period-end"];
const sourcesPath = values.sources;
const outPath = values.out;

if (!asOf || !periodStart || !periodEnd || !sourcesPath || !outPath) {
  throw new Error("Required: --as-of --period-start --period-end --sources --out");
}
if (Number.isNaN(Date.parse(asOf))) throw new Error(`Invalid --as-of: ${asOf}`);

const officialSources: OfficialSources = JSON.parse(await readFile(sourcesPath, "utf8"));

try {
  const snapshot = await exportSnapshot(getAsOf, {
    asOf: new Date(asOf),
    periodStart,
    periodEnd,
    officialSources,
  });
  await writeFile(outPath, JSON.stringify(snapshot, null, 2));
} finally {
  await pool.end();
}
