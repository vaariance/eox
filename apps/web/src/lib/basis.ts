import type { CoxRequest } from "@eox/app-api";

export interface Basis {
  units: number;
  paid: number;
}

const QUANTA_DIGITS = 12;

function scaled(value: string | null, digits: number): number {
  return value === null ? 0 : Number(BigInt(value)) / 10 ** digits;
}

function take(book: Map<string, Basis>, classId: string, units: number): void {
  const entry = book.get(classId);
  if (!entry || entry.units <= 0) return;
  const share = Math.min(1, units / entry.units);
  entry.paid -= entry.paid * share;
  entry.units -= entry.units * share;
}

function give(book: Map<string, Basis>, classId: string, units: number, paid: number): void {
  const entry = book.get(classId) ?? { units: 0, paid: 0 };
  entry.units += units;
  entry.paid += paid;
  book.set(classId, entry);
}

export function costBasis(requests: readonly CoxRequest[], collateralDecimals: number): Map<string, Basis> {
  const unitDigits = QUANTA_DIGITS + collateralDecimals;
  const book = new Map<string, Basis>();
  const filled = requests.filter((request) => request.state === "filled" && request.receipt !== null).sort((left, right) => left.receipt!.sequence - right.receipt!.sequence);
  for (const request of filled) {
    const receipt = request.receipt!;
    const minted = scaled(receipt.minted, unitDigits);
    const proceeds = scaled(receipt.proceeds, collateralDecimals);
    if (request.operation === "deposit" && request.toClass) give(book, request.toClass, minted, scaled(request.amount, collateralDecimals));
    if (request.operation === "redeem" && request.fromClass) take(book, request.fromClass, scaled(request.units, unitDigits));
    if (request.operation === "switch" && request.fromClass && request.toClass) {
      take(book, request.fromClass, scaled(request.units, unitDigits));
      give(book, request.toClass, minted, proceeds);
    }
  }
  return book;
}

export function paidFor(book: Map<string, Basis>, classId: string, heldUnits: number): number | null {
  const entry = book.get(classId);
  if (!entry || heldUnits <= 0) return null;
  if (Math.abs(entry.units - heldUnits) > heldUnits * 1e-6) return null;
  return entry.paid;
}
