"use client";

import { useEffect, useRef, useState } from "react";
import { formatAmount, formatUtcTime } from "@/lib/format";
import type { Point } from "@/lib/sample";

const HEIGHT = 320;
const PAD = { top: 16, right: 72, bottom: 28, left: 8 };

export function LineChart({ points, baseline, digits, label }: { points: Point[]; baseline?: number; digits: number; label: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const values = points.map((point) => point.value);
  const included = baseline === undefined ? values : [...values, baseline];
  const rawLow = Math.min(...included);
  const rawHigh = Math.max(...included);
  const margin = (rawHigh - rawLow || 1) * 0.08;
  const low = rawLow - margin;
  const high = rawHigh + margin;
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (index / (points.length - 1)) * plotWidth;
  const y = (value: number) => PAD.top + (1 - (value - low) / (high - low)) * plotHeight;
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const ticks = [0, 1, 2, 3, 4].map((step) => low + ((high - low) * step) / 4);
  const timeTicks = [0, 1, 2, 3].map((step) => Math.round(((points.length - 1) * step) / 3));
  const active = hover === null ? points.length - 1 : hover;

  return (
    <div ref={frame} className="relative w-full" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${label}: latest ${formatAmount(values[values.length - 1], digits)}`}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - bounds.left - PAD.left) / (plotWidth || 1);
            setHover(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth="1" />
              <text x={width - 4} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="num">
                {formatAmount(tick, digits)}
              </text>
            </g>
          ))}
          {baseline !== undefined && (
            <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y(baseline)} y2={y(baseline)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 4" />
          )}
          {timeTicks.map((index) => (
            <text key={index} x={x(index)} y={HEIGHT - 8} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--muted)" className="num">
              {formatUtcTime(points[index].cutoff).slice(0, 5)}
            </text>
          ))}
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" />
          <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--muted)" strokeWidth="1" opacity={hover === null ? 0 : 0.6} />
          <circle cx={x(active)} cy={y(values[active])} r="3.5" fill="var(--accent)" stroke="var(--bg)" strokeWidth="1.5" />
        </svg>
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded-control border border-line bg-surface px-2 py-1 text-xs">
        <span className="num text-ink">{formatAmount(values[active], digits)}</span>
        <span className="num ml-2 text-muted">{formatUtcTime(points[active].cutoff)}</span>
      </div>
    </div>
  );
}
