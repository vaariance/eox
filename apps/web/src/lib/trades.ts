import type { CoxRequest } from "@eox/app-api";

export interface Trade {
  requestId: string;
  side: "bought" | "sold" | "cashed out";
  sequence: number;
  units: number;
  value: number;
  price: number | null;
}

const QUANTA_DIGITS = 12;

function scaled(value: string | null, digits: number): number {
  return value === null ? 0 : Number(BigInt(value)) / 10 ** digits;
}

export function tradesOf(requests: readonly CoxRequest[], classId: string, collateralDecimals: number): Trade[] {
  const unitDigits = QUANTA_DIGITS + collateralDecimals;
  const trades: Trade[] = [];
  for (const request of requests) {
    if (request.state !== "filled" || request.receipt === null) continue;
    const { receipt } = request;
    const base = { requestId: request.requestId, sequence: receipt.sequence };
    if (request.toClass === classId) {
      const units = scaled(receipt.minted, unitDigits);
      const value = request.operation === "deposit" ? scaled(request.amount, collateralDecimals) : scaled(receipt.proceeds, collateralDecimals);
      trades.push({ ...base, side: "bought", units, value, price: units > 0 ? value / units : null });
    } else if (request.fromClass === classId) {
      const units = scaled(request.units, unitDigits);
      const value = scaled(receipt.proceeds, collateralDecimals);
      trades.push({ ...base, side: request.operation === "redeem" ? "cashed out" : "sold", units, value, price: units > 0 ? value / units : null });
    }
  }
  return trades.sort((left, right) => right.sequence - left.sequence);
}
