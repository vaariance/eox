import type { CoxRequest, Receipt, RequestState } from "@eox/app-api";
import { CircleCheck, CircleX, Clock } from "lucide-react";
import { formatAmount, formatUtcTime, formatWhole } from "@/lib/format";
import { SCALE_DIGITS, toNumber } from "@/lib/view";

const states: Record<RequestState, { label: string; tone: string; Icon: typeof Clock }> = {
  queued: { label: "Queued", tone: "text-warn", Icon: Clock },
  executed: { label: "Executed", tone: "text-up", Icon: CircleCheck },
  rejected: { label: "Rejected", tone: "text-down", Icon: CircleX },
  expired: { label: "Expired", tone: "text-down", Icon: CircleX },
  cancelled: { label: "Cancelled", tone: "text-muted", Icon: CircleX },
};

function subject(request: CoxRequest): string {
  if (request.fromClass && request.toClass) return `${request.fromClass} → ${request.toClass}`;
  return request.toClass ?? request.fromClass ?? "";
}

function size(request: CoxRequest, decimals: number): { value: number; unit: string } {
  if (request.amount !== null) return { value: toNumber(request.amount, decimals), unit: "tCOX" };
  return { value: toNumber(request.units ?? "0", SCALE_DIGITS), unit: "units" };
}

function minimum(request: CoxRequest, decimals: number): string {
  if (BigInt(request.minimumOut) === 0n) return "No minimum";
  if (request.operation === "redeem") return `Min ${formatAmount(toNumber(request.minimumOut, decimals))} tCOX`;
  return `Min ${formatAmount(toNumber(request.minimumOut, SCALE_DIGITS))} units`;
}

function outcome(receipt: Receipt, decimals: number): string {
  const parts: string[] = [];
  if (receipt.unitsOut !== null) parts.push(`received ${formatAmount(toNumber(receipt.unitsOut, SCALE_DIGITS))} units`);
  if (receipt.collateralOut !== null) parts.push(`received ${formatAmount(toNumber(receipt.collateralOut, decimals))} tCOX`);
  parts.push(`unit value ${formatAmount(toNumber(receipt.unitValue, SCALE_DIGITS), 6)}`);
  const text = parts.join(" at ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function paid(receipt: Receipt, decimals: number): { value: number; unit: string } {
  if (receipt.collateralIn !== null) return { value: toNumber(receipt.collateralIn, decimals), unit: "tCOX" };
  return { value: toNumber(receipt.unitsIn ?? "0", SCALE_DIGITS), unit: "units" };
}

const row = "flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 text-sm last:border-b-0";

export function RequestList({ pending, receipts, decimals }: { pending: CoxRequest[]; receipts: Receipt[]; decimals: number }) {
  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Your requests</h2>
      {pending.length === 0 && receipts.length === 0 && <p className="px-4 py-6 text-sm text-muted">No requests yet.</p>}
      <ul>
        {pending.map((request) => {
          const state = states[request.state];
          const amount = size(request, decimals);
          return (
            <li key={request.requestId} className={row}>
              <span className={`flex w-24 items-center gap-1.5 ${state.tone}`}>
                <state.Icon size={14} aria-hidden="true" />
                {state.label}
              </span>
              <span className="w-40 capitalize">
                {request.operation} <span className="normal-case text-muted">{subject(request)}</span>
              </span>
              <span className="num w-36">{formatAmount(amount.value)} <span className="text-xs text-muted">{amount.unit}</span></span>
              <span className="num w-60 text-muted">Batch closing {formatUtcTime(request.batchCutoff)}</span>
              <span className="min-w-64 flex-1 text-xs text-muted">
                {request.rejection ?? `${minimum(request, decimals)} · expires after the ${formatUtcTime(request.expiryCutoff)} batch`}
              </span>
              {request.state === "queued" && (
                <button type="button" disabled title="Available when the live API is connected" className="h-9 rounded-pill border border-line px-3 text-xs opacity-50">
                  Cancel
                </button>
              )}
            </li>
          );
        })}
        {receipts.map((receipt) => {
          const amount = paid(receipt, decimals);
          return (
            <li key={receipt.requestId} className={row}>
              <span className={`flex w-24 items-center gap-1.5 ${states.executed.tone}`}>
                <CircleCheck size={14} aria-hidden="true" />
                Executed
              </span>
              <span className="w-40 capitalize">{receipt.operation}</span>
              <span className="num w-36">{formatAmount(amount.value)} <span className="text-xs text-muted">{amount.unit}</span></span>
              <span className="num w-60 text-muted">Publication #{formatWhole(receipt.sequence)}</span>
              <span className="min-w-64 flex-1 text-xs text-muted">{outcome(receipt, decimals)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
