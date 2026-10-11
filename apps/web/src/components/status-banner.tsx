import type { CoxOrigin, CoxStatus, SystemState } from "@eox/app-api";
import { CircleAlert, CircleCheck, CirclePause } from "lucide-react";
import { formatUtcTime, formatWhole } from "@/lib/format";
import { OpenBatchLabel } from "./open-batch";

const states: Record<SystemState, { label: string; tone: string; Icon: typeof CircleCheck }> = {
  fresh: { label: "Fresh", tone: "text-up", Icon: CircleCheck },
  delayed: { label: "Delayed", tone: "text-warn", Icon: CircleAlert },
  incident: { label: "Incident", tone: "text-warn", Icon: CircleAlert },
  halted: { label: "Halted", tone: "text-down", Icon: CirclePause },
  paused: { label: "Paused", tone: "text-down", Icon: CirclePause },
};

const verdicts = { match: "matches", mismatch: "mismatch", pending: "checking" };

export function StatusBanner({ status, origin }: { status: CoxStatus; origin: CoxOrigin }) {
  const state = states[status.state];
  const mismatch = status.monitor?.verdict === "mismatch";

  return (
    <div className="border-b border-line bg-bg">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 pt-2 text-xs text-muted sm:px-6">
        <span className={`flex items-center gap-1.5 ${state.tone}`}>
          <state.Icon size={14} aria-hidden="true" />
          {state.label}
        </span>
        {status.latestSequence === null || status.latestBatch === null ? (
          <span>No publication yet</span>
        ) : (
          <span>
            Publication <span className="num text-ink">#{formatWhole(status.latestSequence)}</span> for batch{" "}
            <span className="num text-ink">#{formatWhole(status.latestBatch)}</span>
            {status.latestCutoff !== null && <span className="num"> ({formatUtcTime(status.latestCutoff)})</span>}
          </span>
        )}
        {status.executing && <span className="text-warn">Filling the accepted batch</span>}
        {status.currentBatch && <OpenBatchLabel known={status.currentBatch} />}
        {status.monitor && (
          <span className={mismatch ? "text-down" : undefined}>
            Monitor: <span className={mismatch ? "font-medium" : "text-ink"}>{verdicts[status.monitor.verdict]}</span>
          </span>
        )}
        {origin === "fixture" && <span className="ml-auto rounded-pill bg-surface-2 px-2 py-0.5 text-ink">Fixture data: synthetic assets, not market prices</span>}
      </div>
    </div>
  );
}
