import { integer, log, runEvery } from "./env.js";
import { httpEvidenceSource } from "./evidence-source.js";
import { ArchiveMonitor, type MonitorState, emptyMonitorState } from "./monitor.js";
import { createMonitorServer } from "./server.js";
import { readState, writeState } from "./state-file.js";

const evidenceUrl = process.env.EVIDENCE_API_URL ?? "http://127.0.0.1:8787";
const statePath = process.env.MONITOR_STATE ?? "cox-monitor-state.json";
const host = process.env.MONITOR_HOST ?? "127.0.0.1";
const port = Number(integer("MONITOR_PORT", 8792n));
const interval = integer("MONITOR_INTERVAL_SECONDS", 20n);

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
  },
  () => server.close(),
);
