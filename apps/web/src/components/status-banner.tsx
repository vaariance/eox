import { CircleCheck } from "lucide-react";
import { formatUtcTime, formatWhole } from "@/lib/format";
import { publication } from "@/lib/sample";
import { Countdown } from "./countdown";

export function StatusBanner() {
  return (
    <div className="border-b border-line bg-bg">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-xs text-muted sm:px-6">
        <span className="flex items-center gap-1.5 text-up">
          <CircleCheck size={14} aria-hidden="true" />
          Fresh
        </span>
        <span>
          Publication <span className="num text-ink">#{formatWhole(publication.sequence)}</span> at{" "}
          <span className="num text-ink">{formatUtcTime(publication.cutoff)}</span>
        </span>
        <span>
          Next cutoff in <span className="text-ink"><Countdown /></span>
        </span>
        <span>
          Monitor: <span className="text-ink">matches</span>
        </span>
        <span className="ml-auto rounded-pill bg-surface-2 px-2 py-0.5 text-ink">Sample data, not from the API</span>
      </div>
    </div>
  );
}
