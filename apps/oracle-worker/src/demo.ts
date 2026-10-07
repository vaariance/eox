import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Keypair } from "@solana/web3.js";
import { Journal } from "./journal.js";
import { FixtureProvider, sha256, type FixtureFile } from "./provider.js";
import { OracleWorker } from "./worker.js";
import type { Configuration } from "./codec.js";
import { SolanaTransport } from "./solana.js";
import { rustPreview, encodePreview, type PreviewOutput } from "./preview.js";
import assert from "node:assert/strict";

/** Real chain scenario driver. Explicitly uses the trusted adapter, never skips chain deadlines. */
export async function runDemo(transport: SolanaTransport, config: Configuration, fixturePath: string, directory: string, adapterWallet: string, binary: string): Promise<void> {
  const genesis = await transport.program.provider.connection.getGenesisHash();
  if (genesis === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("DemoRefusesMainnet");
  const adapter = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(adapterWallet, "utf8")) as number[]));
  await transport.bootstrap(adapter.publicKey);
  const journal = new Journal(join(directory, "journal.json")); const release = await journal.lock();
  const report: { scenario: string; snapshot: string; signatures: string[]; result: unknown; preview?: PreviewOutput; equality?: true }[] = [];
  let lastPreview: PreviewOutput | undefined;
  const save = () => writeFile(join(directory, "demo-report.json"), JSON.stringify({ mode: "real-rpc-trusted-test-adapter", genesis, scenarios: report }, null, 2));
  const worker = new OracleWorker(new FixtureProvider(fixturePath), transport, journal, value => console.log(JSON.stringify({ publication: value })),
    { batchSeconds: 5, refreshSeconds: 60 }, config.countries.flatMap(c => c.indicators.map(i => `${c.id}/${i.id}`)));
  async function cycle(scenario: string, invalid = false): Promise<void> {
    const started = Date.now(); const before = await journal.load(); const completed = before.publications.length + before.quarantine.length;
    const signatures: string[] = []; let snapshotAddress: string | undefined; let challenged = false;
    while (Date.now() - started < 15 * 60_000) {
      await worker.tick(await transport.chainTime());
      const state = await journal.load();
      if (state.active) {
        const binding = JSON.parse(await readFile(join(directory, "bindings", `${state.active.proposalId}.json`), "utf8")) as { snapshot: string };
        snapshotAddress = binding.snapshot;
        const snapshot = await transport.inspect(snapshotAddress) as { status: number; closed: boolean; deadline: { toNumber(): number } } | null;
        if (!snapshot) { await delay(1_000); continue; }
        if (invalid && snapshot.status === 1 && !challenged) {
          const id = sha256(`EOX-demo-invalid:${snapshotAddress}`);
          signatures.push(await transport.simulateChallenge(adapterWallet, snapshotAddress, "register", id));
          signatures.push(await transport.simulateChallenge(adapterWallet, snapshotAddress, "invalid", id));
          challenged = true;
        }
        if ((snapshot.status === 1 || snapshot.status === 5) && !snapshot.closed) {
          const slot = await transport.program.provider.connection.getSlot("finalized");
          const chainTime = await transport.program.provider.connection.getBlockTime(slot);
          if (chainTime !== null && chainTime >= snapshot.deadline.toNumber()) signatures.push(await transport.simulateChallenge(adapterWallet, snapshotAddress, "close", "0".repeat(64)));
        }
      }
      if (state.publications.length + state.quarantine.length > completed) {
        const latest = state.publications.at(-1);
        const address = snapshotAddress ?? latest?.snapshotAddress;
        if (!address) throw new Error("DemoMissingSnapshot");
        if (invalid && state.quarantine.length === before.quarantine.length) throw new Error("ExpectedRejectedProposal");
        if (!invalid && state.publications.length === before.publications.length) throw new Error("ExpectedPublishedProposal");
        const result = await transport.inspect(address);
        let preview: PreviewOutput | undefined;
        if (!invalid) {
          const comparisons = state.accepted.flatMap(r => r.comparisonRecordId ? [state.records[r.comparisonRecordId]!] : []);
          const input = await transport.previewInput(address, [...state.accepted, ...comparisons]);
          await writeFile(join(directory, `${scenario}-preview-input.json`), encodePreview(input));
          preview = await rustPreview(binary, input);
          const chain = result as { world: { toString(): string }; worldConfidence: { toString(): string }; countries: { state: { toString(): string }; confidence: { toString(): string }; ratio: { toString(): string }; change: { toString(): string }; expressed: { toString(): string }; referenceConfidence: { toString(): string }; saturated: boolean; stale: boolean }[] };
          assert.equal(chain.world.toString(), String(preview.world.state)); assert.equal(chain.worldConfidence.toString(), String(preview.world.confidence));
          chain.countries.forEach((country, i) => {
            const expected = preview!.countries[i]!; const reference = preview!.references[i]!;
            assert.equal(country.state.toString(), String(expected.state)); assert.equal(country.confidence.toString(), String(expected.confidence));
            assert.equal(country.saturated, expected.saturated); assert.equal(country.stale, expected.stale);
            for (const field of ["ratio", "change", "expressed"] as const) assert.equal(country[field].toString(), String(reference[field]));
            assert.equal(country.referenceConfidence.toString(), String(reference.confidence));
          });
          if (scenario === "confidence-refresh" && lastPreview) {
            assert.deepEqual(preview.countries.map(c => c.state), lastPreview.countries.map(c => c.state));
            assert.deepEqual(preview.references.map(r => r.expressed), lastPreview.references.map(r => r.expressed));
            assert.ok(preview.countries.some((country, index) => country.confidence < lastPreview!.countries[index]!.confidence), "Expected freshness-only confidence degradation");
          }
          lastPreview = preview;
        }
        report.push({ scenario, snapshot: address, signatures: [...Object.values(state.transactions).flat(), ...signatures], result, ...(preview ? { preview, equality: true as const } : {}) }); await save(); return;
      }
      await delay(1_000);
    }
    throw new Error(`DemoTimedOut:${scenario}`);
  }
  async function update(label: string, value: string): Promise<void> {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as FixtureFile;
    const currentId = fixture.changes.filter(c => fixture.records.some(r => r.recordId === c.recordId && r.country === config.countries[0]!.id && r.indicator === config.countries[0]!.indicators[0]!.id)).at(-1)!.recordId;
    const old = fixture.records.find(r => r.recordId === currentId)!;
    const revision = { ...old, recordId: sha256(`${label}:${old.recordId}`), revisionId: label, value, supersedes: old.recordId, recordedAt: Math.floor(Date.now() / 1000) };
    const artifact = Buffer.from(JSON.stringify({ fixture: true, revision: label, value })); revision.artifactDigest = sha256(artifact);
    fixture.records.push(revision); fixture.changes.push({ changeId: revision.recordId, recordId: revision.recordId }); fixture.artifacts[revision.artifactDigest] = artifact.toString("base64");
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
  }
  try {
    if ((await journal.load()).publications.length || (await journal.load()).active) throw new Error("DemoRequiresFreshJournalAndEpoch");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as FixtureFile;
    if (!fixture.records.every(r => r.manifest.startsWith("Synthetic fixture"))) throw new Error("DemoRequiresSyntheticFixtures");
    // Put synthetic evidence just beyond its grace period to demonstrate actual freshness decay.
    for (const record of fixture.records) {
      const rule = config.countries.find(c => c.id === record.country)?.indicators.find(i => i.id === record.indicator)?.rule;
      if (!rule) throw new Error("DemoUnknownIndicator");
      record.publishedAt = Math.floor(Date.now() / 1000) - Number(rule.grace_seconds) - 60;
    }
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
    await cycle("baseline");
    await update("accepted-update", "0.003"); await cycle("accepted-update");
    await update("invalid-update", "0.006"); await cycle("rejected-update", true);
    await update("corrected-update", "0.004"); await cycle("corrected-resubmission");
    await cycle("confidence-refresh");
    console.log(JSON.stringify({ report: join(directory, "demo-report.json"), scenarios: report.length }));
  } finally { await release(); }
}
