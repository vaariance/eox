import type {
  ClassValuation,
  CoxAsset,
  CoxDeployment,
  CoxStatus,
  CryptoComposition,
  FallbackStep,
  Portfolio,
  PriceVenue,
  Publication,
  PublishedPrice,
} from "@eox/app-api";

const MINUTES = 240;
const ORIGIN_CUTOFF = 1791633600;
const FIRST_SEQUENCE = 1044;
const FIRST_BATCH = 1102;
const SAMPLE_SOURCE = "apps/web sample data";
const MISSED_MINUTE = MINUTES - 17;
const COLLATERAL_DECIMALS = 6;
const SAMPLE_OWNER = "Samp1eWa11etxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

type Row = [id: string, name: string, price: number, krakenRest: string | null, coinbase: boolean, bybit: boolean];

const ROWS: Row[] = [
  ["BTC", "Bitcoin", 118420, "XXBTZUSD", true, true],
  ["ETH", "Ethereum", 4312, "XETHZUSD", true, true],
  ["SOL", "Solana", 231.4, null, true, true],
  ["XRP", "XRP", 2.94, "XXRPZUSD", true, true],
  ["BNB", "BNB", 1124, null, true, true],
  ["TRX", "Tron", 0.342, null, false, true],
  ["AVAX", "Avalanche", 28.6, null, true, true],
  ["DOT", "Polkadot", 4.18, null, true, true],
  ["NEAR", "NEAR Protocol", 2.91, null, true, true],
  ["SUI", "Sui", 3.52, null, true, true],
  ["APT", "Aptos", 5.07, null, true, true],
  ["UNI", "Uniswap", 7.84, null, true, true],
  ["ARB", "Arbitrum", 0.431, null, true, true],
  ["OP", "Optimism", 0.712, null, true, true],
  ["INJ", "Injective", 12.3, null, true, true],
  ["AAVE", "Aave", 274.5, null, true, true],
  ["ZEC", "Zcash", 152.8, "XZECZUSD", true, false],
  ["STRK", "Starknet", 0.148, null, true, true],
  ["HYPE", "Hyperliquid", 44.9, null, true, true],
  ["TAO", "Bittensor", 318.2, null, true, false],
  ["WLD", "Worldcoin", 1.26, null, true, true],
  ["ONDO", "Ondo", 0.914, null, true, true],
  ["ENA", "Ethena", 0.562, null, true, true],
  ["ZRO", "LayerZero", 2.07, null, true, true],
  ["FET", "Artificial Superintelligence Alliance", 0.587, null, true, true],
  ["JUP", "Jupiter", 0.448, null, false, true],
  ["AERO", "Aerodrome", 1.09, null, true, true],
  ["RENDER", "Render", 3.61, null, true, true],
  ["TIA", "Celestia", 1.52, null, true, true],
  ["W", "Wormhole", 0.0842, null, true, true],
];

const THIN = new Set(["RENDER", "TAO", "APT", "JUP"]);

function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scaled(value: number, digits: number): string {
  const kept = Math.min(digits, 8);
  return (BigInt(Math.round(value * 10 ** kept)) * 10n ** BigInt(digits - kept)).toString();
}

const baseUnits = (value: number) => scaled(value, COLLATERAL_DECIMALS);

const paths = ROWS.map(([, , start], index) => {
  const next = generator(11 + index * 13);
  const drift = (next() - 0.5) * 0.00012;
  const swing = 0.0014 + next() * 0.0022;
  const prices = [start];
  for (let minute = 1; minute < MINUTES; minute += 1) prices.push(prices[minute - 1] * (1 + drift + (next() - 0.5) * swing));
  return prices;
});

const levels = [100];
for (let minute = 1; minute < MINUTES; minute += 1) {
  const growth = paths.reduce((total, prices) => total + prices[minute] / prices[minute - 1], 0) / paths.length;
  levels.push(levels[minute - 1] * growth);
}

const classSeed = generator(97);
const classes: ClassValuation[] = [...ROWS.map(([id]) => id), "CRYPTO"].map((classId, classIndex) => {
  const backing = Math.round((20000 + classSeed() * 480000) * 100) / 100;
  const unitValue = 0.9 + classSeed() * 0.2;
  const state = { backing: baseUnits(backing), units: scaled(backing / unitValue, 12) };
  return { classId, classIndex, transferFactor: null, preRevaluation: state, fixed: state, final: state };
});

const active = classes.reduce((total, item) => total + BigInt(item.final.backing), 0n);
const ledger = {
  active: active.toString(),
  pending: baseUnits(1840),
  refundable: baseUnits(120),
  payable: baseUnits(615.42),
  residual: "37",
  vault: (active + BigInt(baseUnits(1840)) + BigInt(baseUnits(615.42)) + 37n).toString(),
};

const venueSeed = generator(53);

function source(assetId: string, coinbase: boolean, bybit: boolean): { venue: PriceVenue; step: FallbackStep; tradeAgeMinutes: number } {
  const roll = venueSeed();
  if (!THIN.has(assetId) || roll < 0.55) return { venue: "kraken", step: 1, tradeAgeMinutes: 0 };
  if (coinbase && roll < 0.8) return { venue: "coinbase", step: 2, tradeAgeMinutes: 0 };
  if (bybit && roll < 0.9) return { venue: "bybit", step: 3, tradeAgeMinutes: 0 };
  return { venue: "kraken", step: 4, tradeAgeMinutes: 1 + Math.floor(venueSeed() * 6) };
}

const flowSeed = generator(71);

export const publications: Publication[] = [];
for (let minute = 0; minute < MINUTES; minute += 1) {
  if (minute === MISSED_MINUTE) continue;
  const previous = publications[publications.length - 1];
  const sequence = FIRST_SEQUENCE + publications.length;
  const batch = FIRST_BATCH + minute;
  const cutoff = ORIGIN_CUTOFF + minute * 60;
  const prices: PublishedPrice[] = ROWS.map(([assetId, , , , coinbase, bybit], index) => {
    const chosen = source(assetId, coinbase, bybit);
    return { assetId, priceE8: scaled(paths[index][minute], 8), ...chosen, candleStart: cutoff - 60 - chosen.tradeAgeMinutes * 60 };
  });
  publications.push({
    identity: {
      program: null,
      poolId: "sample",
      sequence,
      batch,
      predecessorSequence: previous ? previous.identity.sequence : null,
      predecessorBatch: previous ? previous.identity.batch : null,
      missedBatches: previous && batch - previous.identity.batch > 1 ? [batch - 1] : [],
      cutoff,
      manifestDigest: null,
      snapshotDigest: null,
      stateDigest: null,
      committedAt: cutoff + 20,
      finalization: { transaction: null, slot: null, finalized: true },
    },
    prices,
    benchmarkGross: null,
    benchmark: scaled(levels[minute], 12),
    references: ROWS.map(([assetId], index) => ({
      assetId,
      gross: null,
      reference: scaled((100 * (paths[index][minute] / paths[index][0])) / (levels[minute] / 100), 12),
    })),
    classes,
    flows: {
      acceptedDeposits: "0",
      newPayable: "0",
      transferResidual: "0",
      flowResidual: "0",
      executed: Math.floor(flowSeed() * 9),
      rejected: flowSeed() > 0.85 ? 1 : 0,
    },
    ledger,
    receiptRoot: null,
  });
}

const last = publications[publications.length - 1];

const label = `CRYPTO (pilot, ${ROWS.length} assets)`;

export const deployment: CoxDeployment = {
  origin: "fixture",
  network: "solana-devnet",
  program: null,
  poolId: "sample",
  poolAddress: null,
  collateralMint: null,
  collateralDecimals: COLLATERAL_DECIMALS,
  testCollateral: true,
  transferRule: "COX/TRANSFER/MVP-0",
  methodology: { digest: null, label, status: "draft", assetCount: ROWS.length },
  fixtureSource: SAMPLE_SOURCE,
};

export const assets: CoxAsset[] = ROWS.map(([assetId, name, , krakenRest, coinbase, bybit], classIndex) => {
  const price = last.prices[classIndex];
  return {
    assetId,
    classIndex,
    name,
    venues: {
      krakenWs: `${assetId}/USD`,
      krakenRest: krakenRest ?? `${assetId}USD`,
      coinbase: coinbase ? `${assetId}-USD` : null,
      bybit: bybit ? `${assetId}USDT` : null,
    },
    latest: {
      sequence: last.identity.sequence,
      batch: last.identity.batch,
      priceE8: price.priceE8,
      venue: price.venue,
      step: price.step,
      tradeAgeMinutes: price.tradeAgeMinutes,
    },
  };
});

export const composition: CryptoComposition = {
  label,
  methodologyDigest: null,
  members: ROWS.map(([assetId]) => ({ assetId, weightNumerator: "1", weightDenominator: String(ROWS.length) })),
};

export const status: CoxStatus = {
  asOf: last.identity.cutoff + 20,
  latestSequence: last.identity.sequence,
  latestBatch: last.identity.batch,
  latestCutoff: last.identity.cutoff,
  ageSeconds: 20,
  missedCutoffs: 0,
  state: "fresh",
  executing: false,
  monitor: { sequence: last.identity.sequence, verdict: "match" },
  currentBatch: { batch: last.identity.batch + 1, cutoff: last.identity.cutoff + 60, acceptanceDeadline: last.identity.cutoff + 115 },
};

const request = { owner: SAMPLE_OWNER, fromClass: null, toClass: null, amount: null, units: null, minimumUnits: null, minimumProceeds: null };

export const portfolio: Portfolio = {
  owner: SAMPLE_OWNER,
  appliedSequence: last.identity.sequence,
  positions: [
    { classId: "BTC", units: scaled(1450.25, 12), locked: "0" },
    { classId: "CRYPTO", units: scaled(800, 12), locked: "0" },
  ],
  payable: baseUnits(283.39),
  refundable: baseUnits(120),
  pending: baseUnits(250),
  requests: [
    {
      ...request,
      requestId: "sample-request-4",
      operation: "deposit",
      toClass: "BTC",
      amount: baseUnits(250),
      minimumUnits: scaled(238, 12),
      targetBatch: last.identity.batch + 1,
      expiryBatch: last.identity.batch + 3,
      state: "queued",
      receipt: null,
    },
    {
      ...request,
      requestId: "sample-request-3",
      operation: "switch",
      fromClass: "ETH",
      toClass: "BTC",
      units: scaled(500, 12),
      minimumUnits: "0",
      targetBatch: last.identity.batch - 12,
      expiryBatch: last.identity.batch - 10,
      state: "filled",
      receipt: { requestId: "sample-request-3", sequence: last.identity.sequence - 12, batch: last.identity.batch - 12, status: "filled", minted: scaled(477.61, 12), proceeds: baseUnits(503.57) },
    },
    {
      ...request,
      requestId: "sample-request-2",
      operation: "deposit",
      toClass: "SOL",
      amount: baseUnits(120),
      minimumUnits: scaled(130, 12),
      targetBatch: last.identity.batch - 25,
      expiryBatch: last.identity.batch - 23,
      state: "condition-failed",
      receipt: { requestId: "sample-request-2", sequence: last.identity.sequence - 25, batch: last.identity.batch - 25, status: "condition-failed", minted: "0", proceeds: "0" },
    },
    {
      ...request,
      requestId: "sample-request-1",
      operation: "redeem",
      fromClass: "SOL",
      units: scaled(300, 12),
      minimumProceeds: "0",
      targetBatch: last.identity.batch - 40,
      expiryBatch: last.identity.batch - 38,
      state: "filled",
      receipt: { requestId: "sample-request-1", sequence: last.identity.sequence - 40, batch: last.identity.batch - 40, status: "filled", minted: "0", proceeds: baseUnits(283.39) },
    },
  ],
};
