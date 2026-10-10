import type { Point } from "@/lib/sample";

const WIDTH = 120;
const HEIGHT = 32;

export function Sparkline({ points, tone }: { points: Point[]; tone: "up" | "down" | "flat" }) {
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * WIDTH;
      const y = HEIGHT - 2 - ((value - low) / span) * (HEIGHT - 4);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--muted)";
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
