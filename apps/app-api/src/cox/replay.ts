import type { Publication } from "@eox/app-api";
import type { CoxSource } from "./source.js";

export const STREAM_REPLAY_LIMIT = 1440;
const PAGE = 500;

export async function replay(source: CoxSource, at: number, after: number | null): Promise<Publication[]> {
  const latest = await source.latest(at);
  if (!latest) return [];
  const top = latest.identity.sequence;
  if (after !== null && after >= top) return [];
  const from = Math.max(after ?? -1, top - STREAM_REPLAY_LIMIT);
  const out: Publication[] = [];
  let cursor: number | null = from < 0 ? null : from;
  while (out.length < top - from) {
    const page = await source.publications(at, cursor, Math.min(PAGE, top - from - out.length));
    if (page.length === 0) break;
    out.push(...page);
    cursor = page.at(-1)!.identity.sequence;
  }
  return out;
}
