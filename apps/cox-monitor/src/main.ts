import { firstLine, integer, log, required, runEvery } from "./env.js";
import { httpEvidenceSource } from "./evidence-source.js";
import { ArchiveMonitor, type MonitorState, emptyMonitorState } from "./monitor.js";
import { createMonitorServer } from "./server.js";
import { readState, writeState } from "./state-file.js";
import { venueCandleSource } from "./venue-source.js";

const evidenceUrl = process.env.EVIDENCE_API_URL ?? "http://127.0.0.1:8787";
const statePath = process.env.MONITOR_STATE ?? "cox-monitor-state.json";
const host = process.env.MONITOR_HOST ?? "127.0.0.1";
const port = Number(integer("MONITOR_PORT", 8792n));
const interval = integer("MONITOR_INTERVAL_SECONDS", 20n);
const venueInterval = integer("MONITOR_VENUE_INTERVAL_SECONDS", 600n);
const candles = process.env.MONITOR_VENUE_CHECK === "true" ? venueCandleSource(required("MONITOR_USER_AGENT")) : null;
let nextVenueSweep = 0;

const state = await readState<MonitorState>(statePath, emptyMonitorState());
const monitor = new ArchiveMonitor({
  source: httpEvidenceSource(evidenceUrl),
  state,
  save: (next) => writeState(statePath, next),
  log,
});

const server = createMonitorServer(monitor);
server.listen(port, host, () => log(`verdicts on http://${host}:${port}, evidence from ${evidenceUrl}`));

await runEvery(
  interval,
  "cox-monitor",
  async () => {
    const result = await monitor.tick();
    if (result.checked > 0) log(`checked ${result.checked} cutoffs, ${result.mismatches} mismatches`);
    if (!candles || Date.now() < nextVenueSweep) return;
    nextVenueSweep = Date.now() + Number(venueInterval) * 1000;
    try {
      const sweep = await monitor.sweepVenues(candles);
      if (sweep.confirmed + sweep.mismatches + sweep.unverified > 0) log(`venues: ${sweep.confirmed} confirmed, ${sweep.mismatches} mismatches, ${sweep.unverified} unverified`);
    } catch (error) {
      log(`venue sweep failed: ${firstLine(error)}`);
    }
  },
  () => server.close(),
);
