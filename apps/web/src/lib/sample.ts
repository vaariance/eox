import type {
  ClassValuation,
  CoxAsset,
  CoxDeployment,
  CoxRequest,
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
const MISSED_MINUTE = MINUTES - 17;
const COLLATERAL_DECIMALS = 6;
const SAMPLE_DIGEST = "0".repeat(64);
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
const classes: ClassValuation[] = [...ROWS.map(([id]) => id), "CRYPTO"].map((classId) => {
  const backing = Math.round((20000 + classSeed() * 480000) * 100) / 100;
  const unitValue = 0.9 + classSeed() * 0.2;
  const state = { backing: baseUnits(backing), units: scaled(backing / unitValue, 12) };
  return { classId, preFlow: state, postFlow: state, unitValue: scaled(unitValue, 12) };
});

const activeBacking = classes.reduce((total, item) => total + BigInt(item.postFlow.backing), 0n);
const ledger = {
  activeBacking: activeBacking.toString(),
  pendingDeposits: baseUnits(1840),
  withdrawalPayables: baseUnits(615.42),
  residual: "37",
  vault: (activeBacking + BigInt(baseUnits(1840)) + BigInt(baseUnits(615.42)) + 37n).toString(),
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
  const sequence = FIRST_SEQUENCE + publications.length;
  const prices: PublishedPrice[] = ROWS.map(([assetId, , , , coinbase, bybit], index) => ({
    assetId,
    priceE8: scaled(paths[index][minute], 8),
    ...source(assetId, coinbase, bybit),
  }));
  publications.push({
    identity: {
      program: "sample-program",
      pool: "sample-pool",
      sequence,
      predecessorSequence: publications.length === 0 ? null : sequence - 1,
      cutoff: ORIGIN_CUTOFF + minute * 60,
      methodologyDigest: SAMPLE_DIGEST,
      snapshotDigest: SAMPLE_DIGEST,
      finalization: { transaction: null, slot: null, finalized: true },
    },
    prices,
    cryptoLevel: scaled(levels[minute], 12),
    references: ROWS.map(([assetId], index) => ({
      assetId,
      reference: scaled((100 * (paths[index][minute] / paths[index][0])) / (levels[minute] / 100), 12),
    })),
    classes,
    executedRequests: Math.floor(flowSeed() * 9),
    rejectedRequests: flowSeed() > 0.85 ? 1 : 0,
    ledger,
  });
}

const last = publications[publications.length - 1];

export const deployment: CoxDeployment = {
  origin: "fixture",
  network: "solana-devnet",
  program: null,
  pool: null,
  collateralMint: null,
  collateralDecimals: COLLATERAL_DECIMALS,
  testCollateral: true,
  transferRule: "COX/TRANSFER/MVP-0",
  methodologyDigest: null,
  fixtureSource: "apps/web sample data",
};

export const assets: CoxAsset[] = ROWS.map(([assetId, name, , krakenRest, coinbase, bybit], position) => {
  const price = last.prices[position];
  return {
    assetId,
    position,
    name,
    krakenWsSymbol: `${assetId}/USD`,
    krakenRestPair: krakenRest ?? `${assetId}USD`,
    coinbaseProduct: coinbase ? `${assetId}-USD` : null,
    bybitSymbol: bybit ? `${assetId}USDT` : null,
    lastVenue: price.venue,
    tradeAgeMinutes: price.tradeAgeMinutes,
  };
});

export const composition: CryptoComposition = {
  label: `CRYPTO (pilot, ${ROWS.length} assets)`,
  methodologyDigest: SAMPLE_DIGEST,
  members: ROWS.map(([assetId]) => ({ assetId, weight: scaled(1 / ROWS.length, 12) })),
};

export const status: CoxStatus = {
  asOf: last.identity.cutoff + 20,
  latestSequence: last.identity.sequence,
  latestCutoff: last.identity.cutoff,
  ageSeconds: 20,
  missedCutoffs: 0,
  state: "fresh",
  monitor: { sequence: last.identity.sequence, verdict: "match" },
  currentBatch: { cutoff: last.identity.cutoff + 60, commitDeadline: last.identity.cutoff + 115, state: "open" },
};

const queued: CoxRequest = {
  requestId: "sample-request-3",
  owner: SAMPLE_OWNER,
  operation: "deposit",
  fromClass: null,
  toClass: "BTC",
  amount: baseUnits(250),
  units: null,
  minimumOut: scaled(238, 12),
  batchCutoff: last.identity.cutoff + 60,
  expiryCutoff: last.identity.cutoff + 180,
  state: "queued",
  executedSequence: null,
  rejection: null,
};

function held(classId: string, units: number, deposited: number) {
  const valuation = classes.find((item) => item.classId === classId);
  const unitValue = valuation?.unitValue ? Number(valuation.unitValue) / 1e12 : 1;
  return { classId, units: scaled(units, 12), lockedUnits: "0", redeemableValue: baseUnits(units * unitValue), depositedBasis: baseUnits(deposited) };
}

export const portfolio: Portfolio = {
  owner: SAMPLE_OWNER,
  positions: [held("BTC", 1450.25, 1500), held("CRYPTO", 800, 790)],
  pending: [queued],
  receipts: [
    {
      requestId: "sample-request-2",
      sequence: last.identity.sequence - 12,
      operation: "switch",
      unitValue: scaled(1.03648, 12),
      unitsIn: scaled(500, 12),
      unitsOut: scaled(477.61, 12),
      collateralIn: null,
      collateralOut: null,
    },
    {
      requestId: "sample-request-1",
      sequence: last.identity.sequence - 40,
      operation: "redeem",
      unitValue: scaled(0.944643, 12),
      unitsIn: scaled(300, 12),
      unitsOut: null,
      collateralIn: null,
      collateralOut: baseUnits(283.39),
    },
  ],
  withdrawalPayable: baseUnits(283.39),
  valuedAtSequence: last.identity.sequence,
};
