import type { CoxStatus } from "@eox/app-api";
import { formatUtcTime, formatWhole } from "@/lib/format";

export function FirstPublication({ status }: { status: CoxStatus }) {
  const batch = status.currentBatch;
  return (
    <p className="rounded-card border border-line bg-surface p-4 text-sm text-muted shadow-card">
      Nothing has been published yet, so there are no prices, references or unit values to show.
      {batch && ` The first batch, #${formatWhole(batch.batch)}, closes at ${formatUtcTime(batch.cutoff)} on ${new Date(batch.cutoff * 1000).toISOString().slice(0, 10)}.`}
      {" "}You can already queue a buy. It fills at the first publication, and an empty class starts at a unit value of 1.
    </p>
  );
}
