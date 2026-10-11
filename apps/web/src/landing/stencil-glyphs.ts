type Point = [number, number];
type Line = Point[];

const GLYPHS: Record<string, string> = {
  A: "0,6 0,1.5 1.5,0 2.5,0 4,1.5 4,6|0,3.6 4,3.6",
  B: "0,0 3,0 4,1 4,2 3,3|0,3 3,3 4,4 4,5 3,6 0,6 0,0",
  C: "4,0 1,0 0,1 0,5 1,6 4,6",
  D: "0,0 0,6 3,6 4,5 4,1 3,0 0,0",
  E: "4,0 0,0 0,6 4,6|0,3 3,3",
  F: "4,0 0,0 0,6|0,3 3,3",
  G: "4,0 1,0 0,1 0,5 1,6 4,6 4,3 2,3",
  H: "0,0 0,6|4,0 4,6|0,3 4,3",
  I: "0.5,0 3.5,0|2,0 2,6|0.5,6 3.5,6",
  J: "1,0 4,0 4,5 3,6 1,6 0,5",
  K: "0,0 0,6|0,3 1.5,3 4,0|1.5,3 4,6",
  L: "0,0 0,6 4,6",
  M: "0,6 0,1 1,0 3,0 4,1 4,6|2,0 2,3.6",
  N: "0,6 0,0 4,6 4,0",
  O: "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0",
  P: "0,6 0,0 3,0 4,1 4,2 3,3 0,3",
  Q: "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2.6,4.6 4,6",
  R: "0,6 0,0 3,0 4,1 4,2 3,3 0,3|2,3 4,6",
  S: "4,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 0,6",
  T: "0,0 4,0|2,0 2,6",
  U: "0,0 0,5 1,6 3,6 4,5 4,0",
  V: "0,0 0,3.5 2,6 4,3.5 4,0",
  W: "0,0 0,5 1,6 3,6 4,5 4,0|2,6 2,2.4",
  X: "0,0 4,6|4,0 0,6",
  Y: "0,0 2,3 4,0|2,3 2,6",
  Z: "0,0 4,0 0,6 4,6",
  "0": "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0",
  "1": "0.5,1.5 2,0 2,6|0.5,6 3.5,6",
  "2": "0,1 1,0 3,0 4,1 4,2 0,6 4,6",
  "3": "0,0 4,0 2,2.6 3,2.6 4,3.6 4,5 3,6 0,6",
  "4": "3,6 3,0 0,4 4,4",
  "5": "4,0 0,0 0,2.6 3,2.6 4,3.6 4,5 3,6 0,6",
  "6": "3.5,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3.6 3,2.6 0,2.6",
  "7": "0,0 4,0 1.5,6",
  "8": "1,0 3,0 4,1 4,2 3,3 1,3 0,2 0,1 1,0|1,3 3,3 4,4 4,5 3,6 1,6 0,5 0,4 1,3",
  "9": "0.5,6 3,6 4,5 4,1 3,0 1,0 0,1 0,2.4 1,3.4 4,3.4",
  ".": "1.6,5.4 2.4,5.4",
  ",": "2,5.2 1.4,6.6",
  "-": "0.6,3.2 3.4,3.2",
  "/": "0.4,6 3.6,0",
  ":": "1.6,1.8 2.4,1.8|1.6,5.4 2.4,5.4",
  "!": "2,0 2,3.8|1.6,5.4 2.4,5.4",
  "?": "0,1 1,0 3,0 4,1 4,2 2,3.6 2,4.2|1.6,5.4 2.4,5.4",
  "'": "2,0 2,1.8",
  "+": "2,1.4 2,4.6|0.4,3 3.6,3",
};

const ADVANCE: Record<string, number> = { I: 4, ".": 2.4, ",": 2.4, ":": 2.4, "!": 2.4, "'": 2.4, "1": 4 };
const FULL = 4;
const LETTER_GAP = 1.25;
const SPACE = 2.6;
const SHARP = 0.34;
const EPSILON = 1e-6;

function parse(glyph: string): Line[] {
  return glyph.split("|").map((line) => line.trim().split(/\s+/).map((pair) => pair.split(",").map(Number) as Point));
}

function layout(text: string): { lines: Line[]; width: number } {
  const lines: Line[] = [];
  let x = 0;
  let first = true;
  for (const char of text.toUpperCase()) {
    const glyph = GLYPHS[char];
    if (!first) x += LETTER_GAP;
    first = false;
    if (!glyph) {
      x += SPACE;
      continue;
    }
    const advance = ADVANCE[char] ?? FULL;
    const shift = advance < FULL ? -(FULL - advance) / 2 : 0;
    for (const line of parse(glyph)) lines.push(line.map(([px, py]) => [px + x + shift, py] as Point));
    x += advance;
  }
  return { lines, width: Math.max(0, x) };
}

function direction(from: Point, to: Point): Point {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
}

function same(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON;
}

function sharp(before: Point, corner: Point, after: Point): boolean {
  const incoming = direction(before, corner);
  const outgoing = direction(corner, after);
  return incoming[0] * outgoing[0] + incoming[1] * outgoing[1] < SHARP;
}

function distance(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const span = dx * dx + dy * dy;
  const along = span ? Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / span)) : 0;
  return Math.hypot(point[0] - (a[0] + along * dx), point[1] - (a[1] + along * dy));
}

type End = "" | "cut" | "own";

interface Stroke {
  points: Point[];
  closed: boolean;
}

function cut(lines: Line[], weight: number, gap: number): Stroke[] {
  const half = weight / 2;

  const endOf = (point: Point, index: number): End => {
    let state: End = "";
    lines.forEach((other, position) => {
      if (position === index || state === "cut" || other.length < 2) return;
      if (same(point, other[0]) || same(point, other[other.length - 1])) {
        if (!state) state = position < index ? "cut" : "own";
        return;
      }
      for (let step = 0; step < other.length - 1; step++) {
        if (distance(point, other[step], other[step + 1]) < 0.001) state = "cut";
      }
    });
    return state;
  };

  const strokes: Stroke[] = [];
  lines.forEach((line, index) => {
    if (line.length < 2) return;
    let path = line;
    let head = endOf(line[0], index);
    let tail = endOf(line[line.length - 1], index);

    if (line.length > 2 && same(line[0], line[line.length - 1])) {
      const ring = line.slice(0, -1);
      const size = ring.length;
      const start = ring.findIndex((corner, at) => sharp(ring[(at - 1 + size) % size], corner, ring[(at + 1) % size]));
      if (start < 0) {
        strokes.push({ points: ring, closed: true });
        return;
      }
      path = [...ring.slice(start), ...ring.slice(0, start), ring[start]];
      head = "own";
      tail = "cut";
    }

    const pieces: Array<{ points: Point[]; head: End; tail: End }> = [];
    let current: Point[] = [path[0]];
    let opening = head;
    for (let step = 1; step < path.length; step++) {
      current.push(path[step]);
      if (step < path.length - 1 && sharp(path[step - 1], path[step], path[step + 1])) {
        pieces.push({ points: current, head: opening, tail: "cut" });
        current = [path[step]];
        opening = "own";
      }
    }
    pieces.push({ points: current, head: opening, tail });

    for (const piece of pieces) {
      const points = piece.points.map(([px, py]) => [px, py] as Point);
      const last = points.length - 1;
      const forward = direction(points[0], points[1]);
      const backward = direction(points[last - 1], points[last]);
      const trim = (end: End) => (end === "own" ? -half : end === "cut" ? half + gap : 0);
      const front = trim(piece.head);
      const back = trim(piece.tail);
      points[0] = [points[0][0] + forward[0] * front, points[0][1] + forward[1] * front];
      points[last] = [points[last][0] - backward[0] * back, points[last][1] - backward[1] * back];
      strokes.push({ points, closed: false });
    }
  });
  return strokes;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function stencilPath(text: string, weight: number, gap: number): { path: string; width: number } {
  const { lines, width } = layout(text);
  const path = cut(lines, weight, gap)
    .map((stroke) => stroke.points.map(([px, py], index) => `${index ? "L" : "M"}${round(px)} ${round(py)}`).join("") + (stroke.closed ? "Z" : ""))
    .join("");
  return { path, width };
}
