"use client";

import type { Batch } from "@eox/app-api";
import { useEffect, useState } from "react";
import { formatUtcTime, formatWhole } from "@/lib/format";
import { openBatch } from "@/lib/requests";

export function useOpenBatch(known: Batch | null): { batch: Batch | null; seconds: number | null } {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!known || now === null) return { batch: known, seconds: null };
  const batch = openBatch(known, now);
  return { batch, seconds: batch.cutoff - now };
}

export function closesIn(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TargetBatch({ batch, seconds }: { batch: Batch | null; seconds: number | null }) {
  if (!batch) return <>No open batch</>;
  return (
    <>
      #{formatWhole(batch.batch)} · {formatUtcTime(batch.cutoff)} · closes in {closesIn(seconds)}
    </>
  );
}

export function OpenBatchLabel({ known }: { known: Batch }) {
  const open = useOpenBatch(known);
  return (
    <span>
      Batch <span className="num text-ink">#{formatWhole(open.batch?.batch ?? known.batch)}</span> closes in <span className="num text-ink">{closesIn(open.seconds)}</span>
    </span>
  );
}
