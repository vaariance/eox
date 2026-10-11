import type { CoxRequest, CoxStatus, RequestState } from "@eox/app-api";
import { CircleCheck, CircleX, Clock, Undo2 } from "lucide-react";
import { COLLATERAL } from "@/lib/config";
import { formatAmount, formatUtcTime, formatWhole } from "@/lib/format";
import { SCALE_DIGITS, batchCutoff, toNumber } from "@/lib/view";

const states: Record<RequestState, { label: string; tone: string; Icon: typeof Clock; note: string | null }> = {
  queued: { label: "Queued", tone: "text-warn", Icon: Clock, note: null },
  filled: { label: "Executed", tone: "text-up", Icon: CircleCheck, note: null },
  "condition-failed": { label: "Rejected", tone: "text-down", Icon: CircleX, note: "The result was below your minimum, so nothing moved." },
  expired: { label: "Expired", tone: "text-down", Icon: CircleX, note: "It ran out of batches before a publication." },
  "zero-value-class": { label: "Rejected", tone: "text-down", Icon: CircleX, note: "That class has units but no value, so it cannot take new money." },
  cancelled: { label: "Cancelled", tone: "text-muted", Icon: CircleX, note: null },
  refunded: { label: "Refunded", tone: "text-muted", Icon: Undo2, note: null },
};

function subject(request: CoxRequest): string {
  if (request.fromClass && request.toClass) return `${request.fromClass} → ${request.toClass}`;
  return request.toClass ?? request.fromClass ?? "";
}

function size(request: CoxRequest, decimals: number): string {
  if (request.amount !== null) return `${formatAmount(toNumber(request.amount, decimals))} ${COLLATERAL.symbol}`;
  return `${formatAmount(toNumber(request.units ?? "0", SCALE_DIGITS))} units`;
}

function minimum(request: CoxRequest, decimals: number): string {
  if (request.minimumProceeds !== null && BigInt(request.minimumProceeds) > 0n) return `Min ${formatAmount(toNumber(request.minimumProceeds, decimals))} ${COLLATERAL.symbol}`;
  if (request.minimumUnits !== null && BigInt(request.minimumUnits) > 0n) return `Min ${formatAmount(toNumber(request.minimumUnits, SCALE_DIGITS))} units`;
  return "No minimum";
}

function detail(request: CoxRequest, decimals: number): string {
  const state = states[request.state];
  if (request.state === "queued") return `${minimum(request, decimals)} · expires after batch #${formatWhole(request.expiryBatch)}`;
  if (request.state === "filled" && request.receipt) {
    if (request.operation === "redeem") return `Received ${formatAmount(toNumber(request.receipt.proceeds, decimals))} ${COLLATERAL.symbol}`;
    return `Received ${formatAmount(toNumber(request.receipt.minted, SCALE_DIGITS))} ${request.toClass ?? ""} units`;
  }
  return state.note ?? "";
}

function when(request: CoxRequest, status: CoxStatus): string {
  if (request.receipt) return `Publication #${formatWhole(request.receipt.sequence)}`;
  const cutoff = batchCutoff(status, request.targetBatch);
  return `Batch #${formatWhole(request.targetBatch)}${cutoff === null ? "" : ` · closes ${formatUtcTime(cutoff)}`}`;
}

export function RequestList({ requests, status, decimals }: { requests: CoxRequest[]; status: CoxStatus; decimals: number }) {
  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Your requests</h2>
      {requests.length === 0 && <p className="px-4 py-6 text-sm text-muted">No requests yet.</p>}
      <ul>
        {requests.map((request) => {
          const state = states[request.state];
          return (
            <li key={request.requestId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 text-sm last:border-b-0">
              <span className={`flex w-24 items-center gap-1.5 ${state.tone}`}>
                <state.Icon size={14} aria-hidden="true" />
                {state.label}
              </span>
              <span className="w-40 capitalize">
                {request.operation} <span className="normal-case text-muted">{subject(request)}</span>
              </span>
              <span className="num w-36">{size(request, decimals)}</span>
              <span className="num w-60 text-muted">{when(request, status)}</span>
              <span className="min-w-64 flex-1 text-xs text-muted">{detail(request, decimals)}</span>
              {request.state === "queued" && (
                <button type="button" disabled title="Available when the live API is connected" className="h-9 rounded-pill border border-line px-3 text-xs opacity-50">
                  Cancel
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
