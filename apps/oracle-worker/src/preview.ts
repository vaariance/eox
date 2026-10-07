import { spawn } from "node:child_process";

export interface PreviewOutput {
  countries: { state: number; confidence: number; saturated: boolean; stale: boolean }[];
  world: { state: number; confidence: number };
  references: { ratio: number; change: number; expressed: number; confidence: number }[];
}
const integers = new Set(["value", "published_at", "known_at", "recorded_at", "period", "lower", "upper", "target", "distance", "comparison_period_delta", "grace_seconds", "zero_seconds", "baseline"]);
/** Keep Rust i64 tokens exact instead of passing them through JavaScript floating point. */
export function encodePreview(value: unknown, key = ""): string {
  if (Array.isArray(value)) return `[${value.map(v => encodePreview(v, key === "baseline" ? key : "")).join(",")}]`;
  if (value !== null && integers.has(key)) return BigInt(value as string | number).toString();
  if (value !== null && typeof value === "object") return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${encodePreview(v, k)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function rustPreview(binary: string, input: unknown): Promise<PreviewOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["preview"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let diagnostics = "";
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { diagnostics += chunk; });
    child.on("error", reject); child.on("exit", code => {
      if (code !== 0) { reject(new Error(`PreviewFailed:${diagnostics}`)); return; }
      try { resolve(JSON.parse(output) as PreviewOutput); } catch (error) { reject(error); }
    });
    child.stdin.end(encodePreview(input));
  });
}
