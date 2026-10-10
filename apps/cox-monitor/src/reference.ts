import { REFERENCE_BASE, SCALE, divideNearest, fail, sum, times } from "./arithmetic.js";

export interface ReferenceInput {
  previousPrices: readonly bigint[];
  currentPrices: readonly bigint[];
  originPrices: readonly bigint[];
  previousBenchmark: bigint;
}

export interface ReferenceResult {
  assetGrowth: bigint[];
  benchmarkGrowth: bigint;
  benchmark: bigint;
  references: bigint[];
  transferFactors: bigint[];
}

export function computeReference(input: ReferenceInput): ReferenceResult {
  const { previousPrices, currentPrices, originPrices, previousBenchmark } = input;
  const count = currentPrices.length;
  if (count < 2 || previousPrices.length !== count || originPrices.length !== count) fail("InvalidReferenceInput");
  if (previousBenchmark <= 0n) fail("InvalidReferenceInput");
  for (let index = 0; index < count; index += 1) {
    if (previousPrices[index]! <= 0n || currentPrices[index]! <= 0n || originPrices[index]! <= 0n) fail("InvalidReferenceInput");
  }

  const assetGrowth = currentPrices.map((price, index) => divideNearest(times(price, SCALE), previousPrices[index]!));
  const benchmarkGrowth = divideNearest(sum(assetGrowth), BigInt(count));
  if (benchmarkGrowth <= 0n) fail("InvalidBenchmark");
  const benchmark = divideNearest(times(previousBenchmark, benchmarkGrowth), SCALE);
  if (benchmark <= 0n) fail("InvalidBenchmark");

  const benchmarkSinceOrigin = divideNearest(times(benchmark, SCALE), REFERENCE_BASE);
  if (benchmarkSinceOrigin <= 0n) fail("InvalidBenchmark");

  const references = currentPrices.map((price, index) => {
    const assetSinceOrigin = divideNearest(times(price, SCALE), originPrices[index]!);
    return divideNearest(times(REFERENCE_BASE, assetSinceOrigin), benchmarkSinceOrigin);
  });

  const transferFactors = assetGrowth.map((growth) => divideNearest(times(growth, SCALE), benchmarkGrowth));
  transferFactors.push(SCALE);

  return { assetGrowth, benchmarkGrowth, benchmark, references, transferFactors };
}
