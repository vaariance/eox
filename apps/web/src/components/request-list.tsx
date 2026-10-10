import { CircleCheck, CircleX, Clock } from "lucide-react";
import { formatAmount, formatWhole } from "@/lib/format";
import type { Request } from "@/lib/sample";

const states = {
  queued: { label: "Queued", tone: "text-warn", Icon: Clock },
  executed: { label: "Executed", tone: "text-up", Icon: CircleCheck },
  rejected: { label: "Rejected", tone: "text-down", Icon: CircleX },
};

export function RequestList({ requests }: { requests: Request[] }) {
  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Your requests</h2>
      <ul>
        {requests.map((request) => {
          const state = states[request.state];
          const subject = request.toClassId ? `${request.classId} → ${request.toClassId}` : request.classId;
          return (
            <li key={request.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 text-sm last:border-b-0">
              <span className={`flex w-24 items-center gap-1.5 ${state.tone}`}>
                <state.Icon size={14} aria-hidden="true" />
                {state.label}
              </span>
              <span className="w-40 capitalize">
                {request.operation} <span className="normal-case text-muted">{subject}</span>
              </span>
              <span className="num w-36">{formatAmount(request.amount)} <span className="text-xs text-muted">{request.amountUnit}</span></span>
              <span className="num w-28 text-muted">Batch #{formatWhole(request.batch)}</span>
              <span className="min-w-64 flex-1 text-xs text-muted">{request.detail}</span>
              {request.state === "queued" && (
                <button type="button" className="h-9 cursor-pointer rounded-pill border border-line px-3 text-xs transition-colors duration-150 hover:bg-surface-2">
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
