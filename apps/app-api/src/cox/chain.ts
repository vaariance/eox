import { readFileSync } from "node:fs";
import anchor, { type Idl, type Program } from "@coral-xyz/anchor";
import type { Batch as BatchAccount, checkedPublication, Methodology as MethodologyAccount } from "@cox/client";
import type { Connection } from "@solana/web3.js";
import { COX_FEE_POLICY, CRYPTO_CLASS, type ClassState, type FallbackStep, type FeeConfiguration, type PriceVenue, type Publication, type VenueSymbols } from "@eox/app-api";

const VENUES: readonly PriceVenue[] = ["kraken", "coinbase", "bybit"];
const ASSET_ID = /^[A-Z0-9]{1,12}$/;
const WEIGHT = /^[1-9][0-9]{0,17}$/;

type Integer = { toString(): string };

export interface ManifestAsset {
  assetId: string;
  venues: VenueSymbols;
  weightNumerator: string;
  weightDenominator: string;
}

export interface Manifest {
  digest: string;
  version: string;
  sealed: boolean;
  assets: ManifestAsset[];
  origin: number;
}

export type ChainPublication = ReturnType<typeof checkedPublication>;

export function loadProgram(connection: Connection, idlPath: string): Program {
  const idl = JSON.parse(readFileSync(idlPath, "utf8")) as Idl;
  return new anchor.Program(idl, { connection } as anchor.Provider);
}

const hex = (bytes: Uint8Array | number[]): string => Buffer.from(bytes).toString("hex");
const text = (value: Integer | bigint): string => value.toString();

function symbol(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 32) throw new Error("ManifestVenueSymbolInvalid");
  return value;
}

export function parseManifest(account: MethodologyAccount): Manifest {
  const canonical = JSON.parse(Buffer.from(account.canonical).toString("utf8")) as unknown;
  if (!Array.isArray(canonical) || canonical[0] !== "COX/METHODOLOGY/V1" || typeof canonical[1] !== "string") throw new Error("ManifestDomainInvalid");
  const tuples = canonical[4];
  if (!Array.isArray(tuples) || tuples.length !== account.roster.length) throw new Error("ManifestRosterInvalid");
  const assets = tuples.map((tuple: unknown): ManifestAsset => {
    if (!Array.isArray(tuple) || tuple.length !== 7) throw new Error("ManifestAssetInvalid");
    const [assetId, krakenWs, krakenRest, coinbase, bybit, numerator, denominator] = tuple as unknown[];
    if (typeof assetId !== "string" || !ASSET_ID.test(assetId) || assetId === CRYPTO_CLASS) throw new Error("ManifestAssetInvalid");
    if (typeof numerator !== "string" || typeof denominator !== "string" || !WEIGHT.test(numerator) || !WEIGHT.test(denominator)) throw new Error("ManifestWeightInvalid");
    return { assetId, venues: { krakenWs: symbol(krakenWs), krakenRest: symbol(krakenRest), coinbase: symbol(coinbase), bybit: symbol(bybit) }, weightNumerator: numerator, weightDenominator: denominator };
  });
  if (new Set(assets.map((a) => a.assetId)).size !== assets.length) throw new Error("ManifestAssetDuplicate");
  const origin = Number(account.origin.toString());
  if (!Number.isSafeInteger(origin) || origin % 60 !== 0) throw new Error("ManifestOriginInvalid");
  return { digest: hex(account.digest), version: canonical[1], sealed: account.sealed, assets, origin };
}

export function classIds(manifest: Manifest): string[] {
  return [...manifest.assets.map((a) => a.assetId), CRYPTO_CLASS];
}

function venue(code: number): PriceVenue {
  const value = VENUES[code];
  if (!value) throw new Error("PublicationVenueInvalid");
  return value;
}

function step(value: number): FallbackStep {
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4) throw new Error("PublicationStepInvalid");
  return value;
}

const classState = (backing: Integer | bigint, units: Integer | bigint): ClassState => ({ backing: text(backing), units: text(units) });

export interface PublicationContext {
  program: string;
  poolId: string;
  manifest: Manifest;
  predecessorBatch: number | null;
  finalization: { transaction: string | null; slot: number | null };
}

type FeeFields = {
  feeVersion: Integer | bigint;
  feeBps: number;
  feeCap: Integer | bigint;
  feePending: boolean;
  feePendingVersion: Integer | bigint;
  feePendingBps: number;
  feePendingCap: Integer | bigint;
  feePendingCutoff: Integer | bigint;
};

export function feeConfiguration(fields: FeeFields, migrated: boolean): FeeConfiguration {
  return {
    policy: migrated ? COX_FEE_POLICY : null,
    active: { version: text(fields.feeVersion), bps: fields.feeBps, cap: text(fields.feeCap) },
    scheduled: fields.feePending
      ? { version: text(fields.feePendingVersion), bps: fields.feePendingBps, cap: text(fields.feePendingCap), activationCutoff: Number(text(fields.feePendingCutoff)) }
      : null,
  };
}

export function batchOf(publication: ChainPublication, batch: BatchAccount | null): BatchAccount | null {
  if (!batch || batch.phase !== 2) return null;
  if (text(batch.batchId) !== text(publication.state.batch) || text(batch.sequence) !== text(publication.state.sequence)) return null;
  if (hex(batch.snapshotDigest) !== hex(publication.state.snapshot)) throw new Error("PublicationBatchMismatch");
  if (text(batch.fees) !== text(publication.state.feeState?.batchFees ?? 0n)) throw new Error("PublicationBatchFeeMismatch");
  return batch;
}

export function toPublication(publication: ChainPublication, batch: BatchAccount | null, context: PublicationContext): Publication {
  const { state } = publication;
  const ids = classIds(context.manifest);
  const assetCount = context.manifest.assets.length;
  if (state.prices.length !== assetCount || state.references.length !== ids.length || state.classes.length !== ids.length || (batch && batch.fixed.length !== ids.length)) {
    throw new Error("PublicationShapeMismatch");
  }
  const sequence = Number(state.sequence);
  const scheduled = Number(state.batch);
  const missedBatches: number[] = [];
  if (context.predecessorBatch !== null) for (let b = context.predecessorBatch + 1; b < scheduled; b += 1) missedBatches.push(b);
  const feeState = state.feeState ?? null;
  const committedFees = feeState?.fees ?? 0n;
  const batchFees = feeState?.batchFees ?? 0n;
  let flows: { acceptedDeposits: string; newPayable: string; transferResidual: string; flowResidual: string } | null = null;
  if (batch) {
    const fixedTotal = batch.fixed.reduce((sum, c) => sum + BigInt(c.backing.toString()), 0n);
    const accepted = BigInt(batch.acceptedDeposits.toString());
    const newPayable = BigInt(batch.newPayable.toString());
    const flowResidual = fixedTotal + accepted - newPayable - batchFees - state.active;
    if (flowResidual < 0n) throw new Error("PublicationFlowMismatch");
    flows = { acceptedDeposits: text(accepted), newPayable: text(newPayable), transferResidual: text(batch.transferResidual), flowResidual: text(flowResidual) };
  }
  const vault = state.active + state.pending + state.payable + state.residual + committedFees;
  return {
    identity: {
      program: context.program,
      poolId: context.poolId,
      sequence,
      batch: scheduled,
      predecessorSequence: sequence === 0 ? null : sequence - 1,
      predecessorBatch: context.predecessorBatch,
      missedBatches,
      cutoff: Number(state.cutoff),
      manifestDigest: hex(state.manifest),
      snapshotDigest: hex(state.snapshot),
      stateDigest: hex(publication.stateDigest),
      committedAt: Number(publication.committedAt.toString()),
      finalization: { ...context.finalization, finalized: true },
    },
    prices: publication.prices.map((p, i) => ({
      assetId: context.manifest.assets[i]!.assetId,
      priceE8: text(p.priceE8),
      venue: venue(p.venue),
      step: step(p.step),
      candleStart: Number(p.candleStart.toString()),
      tradeAgeMinutes: p.tradeAgeMinutes,
    })),
    benchmarkGross: null,
    benchmark: text(state.benchmark),
    references: context.manifest.assets.map((a, i) => ({ assetId: a.assetId, gross: null, reference: text(state.references[i]!) })),
    classes: ids.map((classId, i) => {
      const c = state.classes[i]!;
      const fixed = batch ? batch.fixed[i]! : null;
      return {
        classId,
        classIndex: i,
        transferFactor: null,
        preRevaluation: classState(c.preBacking, c.preUnits),
        fixed: fixed ? classState(fixed.backing, fixed.units) : null,
        final: classState(c.postBacking, c.postUnits),
      };
    }),
    flows: {
      acceptedDeposits: flows?.acceptedDeposits ?? null,
      newPayable: flows?.newPayable ?? null,
      transferResidual: flows?.transferResidual ?? null,
      flowResidual: flows?.flowResidual ?? null,
      fees: text(batchFees),
      executed: state.executed,
      rejected: state.rejected,
    },
    ledger: { active: text(state.active), pending: text(state.pending), refundable: null, payable: text(state.payable), residual: text(state.residual), fees: text(committedFees), vault: text(vault) },
    fees: feeState ? feeConfiguration(feeState, true) : null,
    receiptRoot: hex(state.receiptRoot),
  };
}
