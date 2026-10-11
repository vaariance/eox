export interface BarPoint {
  cutoff: number;
  value: number;
}

export interface Bar {
  cutoff: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function barsOf(points: readonly BarPoint[], minutes: number): Bar[] {
  const seconds = minutes * 60;
  const bars: Bar[] = [];
  let bucket: number | null = null;
  for (const point of points) {
    const key = Math.floor((point.cutoff - 1) / seconds);
    const current = bars[bars.length - 1];
    if (current && key === bucket) {
      current.high = Math.max(current.high, point.value);
      current.low = Math.min(current.low, point.value);
      current.close = point.value;
      current.cutoff = point.cutoff;
    } else {
      const open = current ? current.close : point.value;
      bars.push({ cutoff: point.cutoff, open, high: Math.max(open, point.value), low: Math.min(open, point.value), close: point.value });
      bucket = key;
    }
  }
  return bars;
}
