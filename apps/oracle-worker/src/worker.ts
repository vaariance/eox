import { Journal } from "./journal.js";
import { assertReady, sha256 } from "./provider.js";
import type { EvidenceProvider, EvidenceRecord, OracleTransport, PublishedReference } from "./types.js";

const slotKey = (r: EvidenceRecord) => `${r.country}/${r.indicator}`;
export class OracleWorker {
  constructor(private readonly provider: EvidenceProvider, private readonly transport: OracleTransport, private readonly journal: Journal,
    private readonly onPublication: (value: PublishedReference) => void = () => {},
    private readonly timing = { batchSeconds: 5, refreshSeconds: 60 },
    private readonly requiredSlots: string[] = []) {}

  /** Caller holds journal lock. One tick makes bounded progress, never sleeps. */
  async tick(now: number): Promise<void> {
    const state = await this.journal.load();
    const page = await this.provider.readChanges(state.cursor);
    for (const change of page.changes) {
      if (state.seenChanges.includes(change.changeId)) continue;
      const record = await this.provider.loadEvidence(change.recordId);
      if (record.recordId !== change.recordId) throw new Error("ProviderIdentityMismatch");
      if (this.requiredSlots.length && !this.requiredSlots.includes(slotKey(record))) throw new Error(`UnexpectedIndicatorSlot:${slotKey(record)}`);
      assertReady(record, now);
      const previous = state.records[record.recordId];
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error(`ImmutableEvidenceConflict:${record.recordId}`);
      if (state.seenRecords.includes(record.recordId)) {
        // A redelivered immutable record is not a new economic observation.
        state.seenChanges.push(change.changeId);
        continue;
      }
      if (sha256(await this.provider.retrieveArtifact(record.artifactDigest)) !== record.artifactDigest) throw new Error("ArtifactHashMismatch");
      state.records[record.recordId] = record;
      if (record.comparisonRecordId && !state.records[record.comparisonRecordId]) {
        const comparison = await this.provider.loadEvidence(record.comparisonRecordId);
        assertReady(comparison, now);
        if (comparison.recordId !== record.comparisonRecordId || sha256(await this.provider.retrieveArtifact(comparison.artifactDigest)) !== comparison.artifactDigest) throw new Error("ComparisonEvidenceMismatch");
        state.records[comparison.recordId] = comparison;
      }
      state.pending.push({ changeId: change.changeId, record });
      state.seenChanges.push(change.changeId);
      state.seenRecords.push(record.recordId);
      state.batchOpenedAt ??= now;
    }
    state.cursor = page.cursor;
    // Persist the queue before any external mutation; a failed transaction cannot lose input.
    await this.journal.save(state);

    const due = state.pending.length > 0 && now - state.batchOpenedAt! >= this.timing.batchSeconds;
    const refresh = state.latest !== null && now - state.lastRefreshAt >= this.timing.refreshSeconds;
    if (!state.active && (due || (state.pending.length === 0 && refresh))) {
      const selected = new Map(state.accepted.map(record => [slotKey(record), record]));
      for (const change of state.pending) selected.set(slotKey(change.record), change.record);
      if (this.requiredSlots.some(slot => !selected.has(slot))) return;
      const records = [...selected.values()].sort((a, b) => slotKey(a).localeCompare(slotKey(b)));
      const comparisons = records.flatMap(r => r.comparisonRecordId ? [state.records[r.comparisonRecordId]!] : []);
      const proposal = { predecessor: state.latest?.snapshotAddress ?? null, cutoff: now,
        records: [...new Map([...records, ...comparisons].map(r => [r.recordId, r])).values()], changeIds: state.pending.map(c => c.changeId) };
      state.active = { ...proposal, proposalId: sha256(JSON.stringify(proposal)) };
      state.pending = []; state.batchOpenedAt = null;
      await this.journal.save(state);
    }
    if (!state.active) return;
    const progress = await this.transport.advance(state.active);
    const active = state.active;
    state.transactions[active.proposalId] = [...new Set([...(state.transactions[active.proposalId] ?? []), ...progress.transactionSignatures])];
    if (progress.status === "published") {
      if (!progress.publication?.finalized || progress.publication.proposalId !== active.proposalId) throw new Error("UnfinalizedOrMismatchedPublication");
      state.latest = progress.publication;
      state.publications.push(progress.publication);
      // Only current slots are carried forward. Comparison records remain in immutable records.
      const comparisonIds = new Set(active.records.flatMap(r => r.comparisonRecordId ? [r.comparisonRecordId] : []));
      state.accepted = active.records.filter(r => !comparisonIds.has(r.recordId));
      state.active = null; state.lastRefreshAt = now;
      await this.journal.save(state);
      this.onPublication(progress.publication);
      return;
    }
    if (["rejected", "cancelled", "expired"].includes(progress.status)) {
      state.quarantine.push({ proposalId: active.proposalId, reason: progress.status, changeIds: active.changeIds });
      state.active = null; state.lastRefreshAt = now;
    }
    await this.journal.save(state);
  }
}
