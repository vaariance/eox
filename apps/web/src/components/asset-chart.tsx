"use client";

import { useState } from "react";
import type { Point } from "@/lib/view";
import { LineChart } from "./line-chart";

interface Series {
  id: string;
  label: string;
  points: Point[];
  digits: number;
  baseline?: number;
}

const ranges = [
  { label: "1h", minutes: 60 },
  { label: "4h", minutes: 240 },
];

function Tabs<T extends string | number>({ items, value, onChange, name }: { items: { key: T; label: string }[]; value: T; onChange: (next: T) => void; name: string }) {
  return (
    <div role="group" aria-label={name} className="flex gap-1 rounded-control bg-surface-2 p-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={value === item.key}
          onClick={() => onChange(item.key)}
          className={`h-8 cursor-pointer rounded-control px-3 text-xs transition-colors duration-150 ${
            value === item.key ? "bg-surface text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function AssetChart({ series }: { series: Series[] }) {
  const [selected, setSelected] = useState(series[0].id);
  const [minutes, setMinutes] = useState(240);
  const current = series.find((item) => item.id === selected) ?? series[0];

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Tabs name="Series" items={series.map((item) => ({ key: item.id, label: item.label }))} value={selected} onChange={setSelected} />
        <Tabs name="Range" items={ranges.map((range) => ({ key: range.minutes, label: range.label }))} value={minutes} onChange={setMinutes} />
      </div>
      <LineChart points={current.points.slice(-minutes)} baseline={current.baseline} digits={current.digits} label={current.label} />
      <p className="mt-2 text-xs text-muted">One accepted value per one-minute publication. These are reference values, not trades.</p>
    </section>
  );
}
