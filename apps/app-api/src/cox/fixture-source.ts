import { readFileSync } from "node:fs";
import {
  BATCH_SECONDS,
  batchFor,
  COX_TRANSFER_RULE,
  systemState,
  type ClassValuation,
  type CoxAsset,
  type CoxDeployment,
  type CoxStatus,
  type CryptoComposition,
  type Portfolio,
  type Publication,
} from "@eox/app-api";
import type { CoxSource } from "./source.js";

interface FixturePublication extends Omit<Publication, "identity" | "prices" | "receiptRoot"> {
  sequence: number;
  batch: number;
  predecessorSequence: number | null;
  predecessorBatch: number | null;
  missedBatches: number[];
  prices: { assetId: string; priceE8: string }[];
  classes: ClassValuation[];
}

interface FixtureFile {
  schema: "cox.app-api/fixture/v1";
  source: { oracle: string; oracleSha256: string; note: string };
  methodology: { digest: string | null; label: string; status: "draft"; assetCount: number };
  assets: { assetId: string; name: string; classIndex: number }[];
  publications: FixturePublication[];
  wallets: Portfolio[] extends (infer W)[] ? Omit<W, "appliedSequence">[] : never;
}

export class CoxFixtureSource implements CoxSource {
  private readonly fixture: FixtureFile;
  private readonly latestBatch: number;

  constructor(path: string) {
    this.fixture = JSON.parse(readFileSync(path, "utf8")) as FixtureFile;
    if (this.fixture.schema !== "cox.app-api/fixture/v1") throw new Error(`unsupported fixture schema ${this.fixture.schema}`);
    this.latestBatch = this.fixture.publications.at(-1)!.batch;
  }

  private origin(now: number): number {
    return Math.floor(now / BATCH_SECONDS) * BATCH_SECONDS - this.latestBatch * BATCH_SECONDS;
  }

  async deployment(): Promise<CoxDeployment> {
    return {
      origin: "fixture",
      network: "fixture",
      program: null,
      poolId: "0",
      poolAddress: null,
      collateralMint: null,
      collateralDecimals: null,
      testCollateral: true,
      transferRule: COX_TRANSFER_RULE,
      methodology: this.fixture.methodology,
      fixtureSource: `${this.fixture.source.oracle}@${this.fixture.source.oracleSha256.slice(0, 12)}: ${this.fixture.source.note}`,
    };
  }

  async publications(now: number): Promise<readonly Publication[]> {
    const origin = this.origin(now);
    return this.fixture.publications.map((p) => {
      const cutoff = origin + p.batch * BATCH_SECONDS;
      return {
        identity: {
          program: null,
          poolId: "0",
          sequence: p.sequence,
          batch: p.batch,
          predecessorSequence: p.predecessorSequence,
          predecessorBatch: p.predecessorBatch,
          missedBatches: p.missedBatches,
          cutoff,
          manifestDigest: this.fixture.methodology.digest,
          snapshotDigest: null,
          stateDigest: null,
          committedAt: cutoff + 20,
          finalization: { transaction: null, slot: null, finalized: true },
        },
        prices: p.prices.map((price) => ({ ...price, venue: "kraken", step: 1, candleStart: cutoff - BATCH_SECONDS, tradeAgeMinutes: 0 })),
        benchmarkGross: p.benchmarkGross,
        benchmark: p.benchmark,
        references: p.references,
        classes: p.classes,
        flows: p.flows,
        ledger: p.ledger,
        receiptRoot: null,
      };
    });
  }

  async status(now: number): Promise<CoxStatus> {
    const latest = (await this.publications(now)).at(-1)!;
    const current = batchFor(now, this.origin(now));
    const missedCutoffs = Math.max(0, current.batch - latest.identity.batch - 1);
    return {
      asOf: now,
      latestSequence: latest.identity.sequence,
      latestBatch: latest.identity.batch,
      latestCutoff: latest.identity.cutoff,
      ageSeconds: now - latest.identity.cutoff,
      missedCutoffs,
      state: systemState(missedCutoffs, false, false),
      executing: false,
      monitor: null,
      currentBatch: current,
    };
  }

  async assets(now: number): Promise<CoxAsset[]> {
    const latest = (await this.publications(now)).at(-1)!;
    return this.fixture.assets.map((asset) => {
      const price = latest.prices.find((p) => p.assetId === asset.assetId)!;
      return {
        assetId: asset.assetId,
        classIndex: asset.classIndex,
        name: asset.name,
        venues: { krakenWs: null, krakenRest: null, coinbase: null, bybit: null },
        latest: { sequence: latest.identity.sequence, batch: latest.identity.batch, priceE8: price.priceE8, venue: price.venue, step: price.step, tradeAgeMinutes: price.tradeAgeMinutes },
      };
    });
  }

  async crypto(): Promise<CryptoComposition> {
    const n = String(this.fixture.assets.length);
    return {
      label: this.fixture.methodology.label,
      methodologyDigest: this.fixture.methodology.digest,
      members: this.fixture.assets.map((a) => ({ assetId: a.assetId, weightNumerator: "1", weightDenominator: n })),
    };
  }

  async portfolio(owner: string): Promise<Portfolio | null> {
    const wallet = this.fixture.wallets.find((w) => w.owner === owner);
    if (!wallet) return null;
    return { ...wallet, appliedSequence: this.fixture.publications.at(-1)!.sequence };
  }

  onPublication(): () => void {
    return () => {};
  }
}
