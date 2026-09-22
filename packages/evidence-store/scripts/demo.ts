import { recordObservation, getAsOf, getLatest, getHistory, pool } from "../src/index.js";

const q = { countryIso3: "NGA", indicatorId: "gdp_real_growth_yoy", sourceId: "nbs-ng" };
const period = { periodStart: "2025-01-01", periodEnd: "2025-03-31" };

const releases = [
  { value: "3.2", vintage: "first",   date: "2025-05-30T10:00:00Z" },
  { value: "2.9", vintage: "second",  date: "2025-06-30T10:00:00Z" },
  { value: "3.1", vintage: "third",   date: "2025-08-29T10:00:00Z" },
  { value: "2.7", vintage: "rebased", date: "2026-02-14T10:00:00Z" },
];

if ((await getHistory(q, period.periodStart)).length === 0) {
  for (const r of releases) {
    await recordObservation({
      ...q, ...period, value: r.value, vintage: r.vintage,
      publishedAt: r.date, knownAt: r.date,
    });
  }
}

const show = (label: string, rows: { value: string; vintage: string }[]) =>
  console.log(label.padEnd(38), rows.map((r) => `${Number(r.value)}% (${r.vintage})`).join(", "));

console.log("\nNigeria real GDP growth, Q1 2025\n");
show("What we believed on 15 Jun 2025:", await getAsOf(q, "2025-06-15"));
show("What we believed on 1 Sep 2025:",  await getAsOf(q, "2025-09-01"));
show("What we believe today:",           await getLatest(q));

console.log("\nEvery version ever recorded:");
for (const r of await getHistory(q, period.periodStart)) {
  console.log(`  ${r.knownAt.toISOString().slice(0, 10)}  ${Number(r.value)}%  (${r.vintage})`);
}

console.log("\nTrying to overwrite history with UPDATE...");
try {
  await pool.query("UPDATE observations SET value = 99 WHERE country_iso3 = 'NGA'");
  console.log("  !! update succeeded, this should never happen");
} catch (e) {
  console.log("  blocked:", (e as Error).message);
}

await pool.end();
