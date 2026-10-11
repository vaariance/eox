"use client";

import { useState } from "react";
import type { Point } from "@/lib/view";
import { type ChartLine, type ChartMark, TradeChart } from "./trade-chart";

export interface Series {
  id: string;
  label: string;
  points: Point[];
  digits: number;
  baseline?: number;
  lines?: ChartLine[];
  marks?: ChartMark[];
  compare?: number;
}

const ranges = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "4h", minutes: 240 },
];

function Tabs<T extends string | number>({ items, value, onChange, name }: { items: { key: T; label: string }[]; value: T; onChange: (next: T) => void; name: string }) {
  return (
    <div role="group" aria-label={name} className="flex gap-0.5">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={value === item.key}
          onClick={() => onChange(item.key)}
          className={`h-8 cursor-pointer rounded-control px-2.5 text-xs transition-colors duration-150 ${value === item.key ? "bg-surface-2 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function AssetChart({ series, note, height }: { series: Series[]; note?: string; height?: number }) {
  const [selected, setSelected] = useState(series[0].id);
  const [minutes, setMinutes] = useState(240);
  const current = series.find((item) => item.id === selected) ?? series[0];
  const shown = current.points.slice(-minutes);
  const lines = [...(current.lines ?? []), ...(current.baseline === undefined ? [] : [{ value: current.baseline, label: "Start", tone: "ink" as const }])];

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-2 py-1.5">
        <Tabs name="Series" items={series.map((item) => ({ key: item.id, label: item.label }))} value={selected} onChange={setSelected} />
        <Tabs name="Range" items={ranges.map((range) => ({ key: range.minutes, label: range.label }))} value={minutes} onChange={setMinutes} />
      </div>
      <div className="px-1 pb-1 pt-2">
        {shown.length > 1 ? (
          <TradeChart points={shown} digits={current.digits} label={current.label} lines={lines} marks={current.marks} compare={current.compare} height={height} />
        ) : (
          <p className="flex items-center justify-center text-sm text-muted" style={{ height: height ?? 420 }}>This line starts with the next publication.</p>
        )}
      </div>
      {note && <p className="border-t border-line px-4 py-2 text-xs text-muted">{note}</p>}
    </section>
  );
}
