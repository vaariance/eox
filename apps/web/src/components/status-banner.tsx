import type { CoxStatus, SystemState } from "@eox/app-api";
import { CircleAlert, CircleCheck, CirclePause } from "lucide-react";
import { formatUtcTime, formatWhole } from "@/lib/format";
import { Countdown } from "./countdown";

const states: Record<SystemState, { label: string; tone: string; Icon: typeof CircleCheck }> = {
  fresh: { label: "Fresh", tone: "text-up", Icon: CircleCheck },
  delayed: { label: "Delayed", tone: "text-warn", Icon: CircleAlert },
  incident: { label: "Incident", tone: "text-warn", Icon: CircleAlert },
  halted: { label: "Halted", tone: "text-down", Icon: CirclePause },
  paused: { label: "Paused", tone: "text-down", Icon: CirclePause },
};

const verdicts = { match: "matches", mismatch: "mismatch", pending: "checking" };

export function StatusBanner({ status, sample }: { status: CoxStatus; sample: boolean }) {
  const state = states[status.state];
  const mismatch = status.monitor?.verdict === "mismatch";

  return (
    <div className="border-b border-line bg-bg">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 pt-2 text-xs text-muted sm:px-6">
        <span className={`flex items-center gap-1.5 ${state.tone}`}>
          <state.Icon size={14} aria-hidden="true" />
          {state.label}
        </span>
        {status.latestSequence === null || status.latestCutoff === null ? (
          <span>No publication yet</span>
        ) : (
          <span>
            Publication <span className="num text-ink">#{formatWhole(status.latestSequence)}</span> for the{" "}
            <span className="num text-ink">{formatUtcTime(status.latestCutoff)}</span> batch
          </span>
        )}
        <span>
          Next cutoff in <span className="text-ink"><Countdown /></span>
        </span>
        <span className={mismatch ? "text-down" : undefined}>
          Monitor: <span className={mismatch ? "font-medium" : "text-ink"}>{status.monitor ? verdicts[status.monitor.verdict] : "no verdict yet"}</span>
        </span>
        {sample && <span className="ml-auto rounded-pill bg-surface-2 px-2 py-0.5 text-ink">Sample data, not from the API</span>}
      </div>
      <p className="mx-auto w-full max-w-7xl px-4 pb-2 pt-1 text-xs text-muted sm:px-6">
        Solana devnet · Test collateral · MVP-0 is a test mechanism · Prices attested by the operator from exchange data
      </p>
    </div>
  );
}
