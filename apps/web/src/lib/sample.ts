export type AssetId = "BTC" | "ETH" | "SOL";
export type ClassId = AssetId | "CRYPTO";

export interface Point {
  cutoff: number;
  value: number;
}

export interface Asset {
  id: AssetId;
  name: string;
  feed: string;
  price: Point[];
  reference: Point[];
}

export interface ClaimClass {
  id: ClassId;
  backing: number;
  units: number;
  unitValue: number;
}

export interface Request {
  id: string;
  operation: "deposit" | "switch" | "redeem";
  classId: ClassId;
  toClassId?: ClassId;
  amount: number;
  amountUnit: "tCOX" | "units";
  batch: number;
  state: "queued" | "executed" | "rejected";
  detail: string;
}

const MINUTES = 240;
const ORIGIN_CUTOFF = 1791633600;
const FIRST_SEQUENCE = 1044;

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

function walk(seed: number, start: number, drift: number, swing: number): number[] {
  const next = generator(seed);
  const prices = [start];
  for (let minute = 1; minute < MINUTES; minute += 1) {
    const step = drift + (next() - 0.5) * swing;
    prices.push(prices[minute - 1] * (1 + step));
  }
  return prices;
}

const definitions: { id: AssetId; name: string; feed: string; prices: number[] }[] = [
  { id: "BTC", name: "Bitcoin", feed: "Crypto.BTC/USD", prices: walk(11, 118420, 0.00002, 0.0016) },
  { id: "ETH", name: "Ether", feed: "Crypto.ETH/USD", prices: walk(23, 4312, 0.00005, 0.0022) },
  { id: "SOL", name: "Solana", feed: "Crypto.SOL/USD", prices: walk(37, 231.4, -0.00003, 0.003) },
];

const levels = [100];
for (let minute = 1; minute < MINUTES; minute += 1) {
  const growth = definitions.reduce((sum, asset) => sum + asset.prices[minute] / asset.prices[minute - 1], 0) / definitions.length;
  levels.push(levels[minute - 1] * growth);
}

const MISSED_MINUTE = MINUTES - 17;

function series(values: number[]): Point[] {
  return values.map((value, minute) => ({ cutoff: ORIGIN_CUTOFF + minute * 60, value })).filter((_, minute) => minute !== MISSED_MINUTE);
}

export const crypto = {
  label: `CRYPTO (pilot, ${definitions.length} assets)`,
  level: series(levels),
  weight: 1 / definitions.length,
};

export const assets: Asset[] = definitions.map((asset) => ({
  id: asset.id,
  name: asset.name,
  feed: asset.feed,
  price: series(asset.prices),
  reference: series(asset.prices.map((price, minute) => (100 * (price / asset.prices[0])) / (levels[minute] / 100))),
}));

export const classes: ClaimClass[] = [
  { id: "BTC", backing: 412880.5, units: 398112.204, unitValue: 1.037096 },
  { id: "ETH", backing: 268415.12, units: 270930.881, unitValue: 0.990714 },
  { id: "SOL", backing: 141902.77, units: 150218.4, unitValue: 0.944643 },
  { id: "CRYPTO", backing: 96330.0, units: 95871.552, unitValue: 1.004782 },
];

export const publication = {
  sequence: FIRST_SEQUENCE + MINUTES - 1,
  cutoff: ORIGIN_CUTOFF + (MINUTES - 1) * 60,
  status: "fresh" as const,
  monitor: "matches" as const,
};

export interface Position {
  classId: ClassId;
  units: number;
  deposited: number;
}

export const positions: Position[] = [
  { classId: "BTC", units: 1450.25, deposited: 1500 },
  { classId: "CRYPTO", units: 800, deposited: 790 },
];

export const account = {
  withdrawalPayable: 120,
  pendingDeposits: 250,
  withdrawals: [
    { id: "w2", amount: 310.42, batch: FIRST_SEQUENCE + MINUTES - 64 },
    { id: "w1", amount: 95, batch: FIRST_SEQUENCE + MINUTES - 171 },
  ],
};

export interface PublicationRow {
  batch: number;
  cutoff: number;
  missed: boolean;
  level: number;
  references: Record<AssetId, number>;
  executed: number;
  rejected: number;
}

const counts = generator(71);

export const history: PublicationRow[] = levels
  .map((level, minute) => ({
    batch: FIRST_SEQUENCE + minute,
    cutoff: ORIGIN_CUTOFF + minute * 60,
    missed: minute === MISSED_MINUTE,
    level,
    references: Object.fromEntries(
      definitions.map((asset) => [asset.id, (100 * (asset.prices[minute] / asset.prices[0])) / (level / 100)]),
    ) as Record<AssetId, number>,
    executed: Math.floor(counts() * 9),
    rejected: counts() > 0.85 ? 1 : 0,
  }))
  .reverse();

export const requests: Request[] = [
  { id: "r3", operation: "deposit", classId: "BTC", amount: 250, amountUnit: "tCOX", batch: publication.sequence + 1, state: "queued", detail: "Min units 238.00 · expires after 3 batches" },
  { id: "r2", operation: "switch", classId: "ETH", toClassId: "BTC", amount: 500, amountUnit: "units", batch: publication.sequence - 12, state: "executed", detail: "Received 477.61 BTC units at 1.036480" },
  { id: "r1", operation: "redeem", classId: "SOL", amount: 300, amountUnit: "units", batch: publication.sequence - 40, state: "rejected", detail: "Condition failed: proceeds 283.39 below minimum 290.00" },
];

export function findAsset(id: string): Asset | undefined {
  return assets.find((asset) => asset.id === id);
}

export function findClass(id: ClassId): ClaimClass {
  const match = classes.find((item) => item.id === id);
  if (!match) throw new Error(`unknown class ${id}`);
  return match;
}

export function change(points: Point[], minutes: number): number {
  const last = points[points.length - 1].value;
  const first = points[Math.max(0, points.length - 1 - minutes)].value;
  return last / first - 1;
}

export function latest(points: Point[]): number {
  return points[points.length - 1].value;
}
