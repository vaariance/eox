import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  CountryReference,
  CountryState,
  Deployment,
  EvidenceReadiness,
  Proposal,
  ProposalAssertion,
  Reference,
} from "@eox/app-api";
import { pairKey, type PublishedSnapshot, type ReferenceSource } from "./source.js";

interface GeneratedState {
  country: string;
  state: string;
  confidence: string;
  saturated: boolean;
  stale: boolean;
}

interface GeneratedScenario {
  file: string;
  multiplier: number;
  evidenceDigest: string;
  countries: string[];
  baseline: string[];
  states: GeneratedState[];
  world: Omit<GeneratedState, "country">;
  references: (Reference & { country: string })[];
  pairs: (Reference & { base: string; quote: string })[];
  slots: { country: string; indicator: string; recordId: string; publishedAt: string | null }[];
}

interface Timeline {
  network: string;
  epoch: string;
  methodology: string;
  baselineId: string;
  snapshots: {
    sequence: number;
    snapshotId: string;
    scenario: string;
    cutoffOffset: number;
    postcommittedOffset: number;
    publishedOffset: number;
  }[];
  proposal: {
    proposalId: string;
    cutoffOffset: number;
    state: Proposal["state"];
    assertions: (Omit<ProposalAssertion, "challengeStart" | "challengeDeadline"> & {
      challengeStartOffset: number;
      challengeDeadlineOffset: number;
    })[];
  } | null;
}

const reference = (value: Reference): Reference => ({
  ratio: value.ratio,
  change: value.change,
  expressed: value.expressed,
  confidence: value.confidence,
});

const countryState = (value: Omit<GeneratedState, "country">): CountryState => ({
  state: value.state,
  confidence: value.confidence,
  saturated: value.saturated,
  stale: value.stale,
});

function worldBaseline(baseline: readonly string[]): string {
  const total = baseline.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total % BigInt(baseline.length) !== 0n) throw new Error("fixture baseline does not average to an exact WORLD baseline");
  return (total / BigInt(baseline.length)).toString();
}

function fixtureDigest(label: string): string {
  return createHash("sha256").update(`eox-app-api-fixture:${label}`).digest("hex");
}

export class FixtureReferenceSource implements ReferenceSource {
  private readonly snapshots: PublishedSnapshot[];
  private readonly pairs = new Map<string, ReadonlyMap<string, Reference>>();
  private readonly currentProposal: Proposal | null;
  private readonly slotReadiness: EvidenceReadiness;
  private readonly info: Deployment;

  constructor(previewPath: string, timelinePath: string, anchorSeconds: number) {
    const preview = JSON.parse(readFileSync(previewPath, "utf8")) as { scenarios: GeneratedScenario[] };
    const timeline = JSON.parse(readFileSync(timelinePath, "utf8")) as Timeline;
    const scenarios = new Map(preview.scenarios.map((scenario) => [scenario.file, scenario]));
    const at = (offset: number) => anchorSeconds + offset;

    this.info = {
      origin: "fixture",
      network: timeline.network,
      oracleProgram: null,
      registry: null,
      fixtureSource: "packages/oracle/fixtures via apps/app-api/fixture-generator",
    };

    let predecessor: string | null = null;
    this.snapshots = [...timeline.snapshots]
      .sort((a, b) => a.sequence - b.sequence)
      .map((entry) => {
        const scenario = scenarios.get(entry.scenario);
        if (!scenario) throw new Error(`fixture timeline references missing scenario ${entry.scenario}`);
        const countries: CountryReference[] = scenario.countries.map((country, index) => {
          const state = scenario.states[index]!;
          const ref = scenario.references[index]!;
          if (state.country !== country || ref.country !== country) {
            throw new Error(`fixture scenario ${scenario.file} has misaligned country ${country}`);
          }
          return { country, ...countryState(state), baseline: scenario.baseline[index]!, reference: reference(ref) };
        });
        const snapshot: PublishedSnapshot = {
          identity: {
            snapshotId: entry.snapshotId,
            sequence: entry.sequence,
            epoch: timeline.epoch,
            epochAddress: null,
            configurationDigest: fixtureDigest(`configuration:${timeline.methodology}`),
            baselineId: timeline.baselineId,
            predecessor,
            cutoff: at(entry.cutoffOffset),
            postcommittedAt: at(entry.postcommittedOffset),
            publishedAt: at(entry.publishedOffset),
            evidenceDigest: scenario.evidenceDigest,
            precommitment: fixtureDigest(`precommitment:${entry.snapshotId}`),
            postcommitment: fixtureDigest(`postcommitment:${entry.snapshotId}`),
            challengeEventDigest: fixtureDigest(`challenge-events:${entry.snapshotId}`),
            challengeEventCount: 0,
            finalization: { transaction: null, slot: null, finalized: true },
          },
          multiplier: scenario.multiplier,
          world: { state: scenario.world.state, confidence: scenario.world.confidence, baseline: worldBaseline(scenario.baseline) },
          countries,
        };
        this.pairs.set(entry.snapshotId, new Map(scenario.pairs.map((pair) => [pairKey(pair.base, pair.quote), reference(pair)])));
        predecessor = entry.snapshotId;
        return snapshot;
      });

    const latest = this.snapshots.at(-1);
    this.currentProposal = timeline.proposal
      ? {
          proposalId: timeline.proposal.proposalId,
          epoch: timeline.epoch,
          predecessor: latest?.identity.snapshotId ?? null,
          cutoff: at(timeline.proposal.cutoffOffset),
          state: timeline.proposal.state,
          assertions: timeline.proposal.assertions.map((assertion) => ({
            assertionId: assertion.assertionId,
            kind: assertion.kind,
            subject: assertion.subject,
            state: assertion.state,
            challengeStart: at(assertion.challengeStartOffset),
            challengeDeadline: at(assertion.challengeDeadlineOffset),
          })),
        }
      : null;

    const latestScenario = latest ? scenarios.get(timeline.snapshots.at(-1)!.scenario)! : null;
    this.slotReadiness = {
      evaluatedAt: latest?.identity.cutoff ?? anchorSeconds,
      slots: (latestScenario?.slots ?? []).map((slot) => ({
        country: slot.country,
        indicator: slot.indicator,
        status: slot.publishedAt === null ? "missing-publication-time" : "ready",
        recordId: slot.recordId,
      })),
    };
  }

  async deployment(): Promise<Deployment> {
    return this.info;
  }

  async publications(): Promise<readonly PublishedSnapshot[]> {
    return this.snapshots;
  }

  async pair(snapshot: PublishedSnapshot, base: string, quote: string): Promise<Reference | null> {
    return this.pairs.get(snapshot.identity.snapshotId)?.get(pairKey(base, quote)) ?? null;
  }

  async paused(): Promise<boolean> {
    return false;
  }

  async proposal(): Promise<Proposal | null> {
    return this.currentProposal;
  }

  async readiness(): Promise<EvidenceReadiness> {
    return this.slotReadiness;
  }

  onPublication(): () => void {
    return () => {};
  }
}
