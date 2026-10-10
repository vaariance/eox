import { pool } from "@eox/evidence-store";

export const FAIL_ABOVE_SHARE = 0.001;

export interface AssetCheck {
  assetId: string;
  cutoffs: number;
  inadmissible: number;
  inadmissibleShare: number;
  byStep: Record<string, number>;
  maxTradeAgeMinutes: number;
  passes: boolean;
}

export interface VenueCheck {
  venue: string;
  responses: number;
  rateLimitedAttempts: number;
  unavailableAttempts: number;
}

export interface FeedCheck {
  from: number;
  to: number;
  snapshots: number;
  admissibleSnapshots: number;
  assets: AssetCheck[];
  venues: VenueCheck[];
}

export async function feedCheck(from: number, to: number): Promise<FeedCheck> {
  const snapshots = await pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE admissible)::int AS admissible FROM snapshots WHERE cutoff >= $1 AND cutoff < $2`,
    [from, to],
  );
  const total: number = snapshots.rows[0].total;
  const assets = await pool.query(
    `SELECT a.asset_id AS "assetId",
            count(o.id) FILTER (WHERE o.admissible)::int AS admissible,
            coalesce(max(o.trade_age_minutes), 0)::int AS "maxTradeAge"
       FROM assets a
       LEFT JOIN price_observations o ON o.asset_id = a.asset_id AND o.cutoff >= $1 AND o.cutoff < $2
      GROUP BY a.asset_id, a.position
      ORDER BY a.position`,
    [from, to],
  );
  const steps = await pool.query(
    `SELECT asset_id AS "assetId", venue || ':' || step AS step, count(*)::int AS n
       FROM price_observations WHERE cutoff >= $1 AND cutoff < $2 GROUP BY 1, 2`,
    [from, to],
  );
  const venues = await pool.query(
    `SELECT v.venue,
            (SELECT count(*)::int FROM venue_responses r WHERE r.venue = v.venue AND r.cutoff >= $1 AND r.cutoff < $2) AS responses,
            (SELECT count(*)::int FROM venue_attempts t WHERE t.venue = v.venue AND t.outcome = 'rate-limited' AND t.cutoff >= $1 AND t.cutoff < $2) AS "rateLimited",
            (SELECT count(*)::int FROM venue_attempts t WHERE t.venue = v.venue AND t.outcome = 'unavailable' AND t.cutoff >= $1 AND t.cutoff < $2) AS unavailable
       FROM (VALUES ('kraken'), ('coinbase'), ('bybit')) AS v(venue)`,
    [from, to],
  );
  return {
    from,
    to,
    snapshots: total,
    admissibleSnapshots: snapshots.rows[0].admissible,
    assets: assets.rows.map((row: { assetId: string; admissible: number; maxTradeAge: number }) => {
      const inadmissible = total - row.admissible;
      const share = total === 0 ? 0 : inadmissible / total;
      const byStep: Record<string, number> = {};
      for (const s of steps.rows as { assetId: string; step: string; n: number }[]) if (s.assetId === row.assetId) byStep[s.step] = total === 0 ? 0 : s.n / total;
      return { assetId: row.assetId, cutoffs: total, inadmissible, inadmissibleShare: share, byStep, maxTradeAgeMinutes: row.maxTradeAge, passes: total > 0 && share <= FAIL_ABOVE_SHARE };
    }),
    venues: venues.rows.map((row: { venue: string; responses: number; rateLimited: number; unavailable: number }) => ({
      venue: row.venue,
      responses: row.responses,
      rateLimitedAttempts: row.rateLimited,
      unavailableAttempts: row.unavailable,
    })),
  };
}

const percent = (share: number) => `${(share * 100).toFixed(2)}%`;

export function renderFeedCheck(check: FeedCheck): string {
  const lines = [
    `# COX feed check ${new Date(check.from * 1000).toISOString()} to ${new Date(check.to * 1000).toISOString()}`,
    "",
    `Snapshots: ${check.snapshots}, admissible: ${check.admissibleSnapshots} (${percent(check.snapshots ? check.admissibleSnapshots / check.snapshots : 0)}).`,
    `An asset fails above ${percent(FAIL_ABOVE_SHARE)} inadmissible cutoffs.`,
    "",
    "| Asset | Inadmissible | Kraken | Coinbase | Bybit | Carried | Max trade age (min) | Result |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const a of check.assets) {
    lines.push(
      `| ${a.assetId} | ${a.inadmissible} (${percent(a.inadmissibleShare)}) | ${percent(a.byStep["kraken:1"] ?? 0)} | ${percent(a.byStep["coinbase:2"] ?? 0)} | ${percent(a.byStep["bybit:3"] ?? 0)} | ${percent(a.byStep["kraken:4"] ?? 0)} | ${a.maxTradeAgeMinutes} | ${a.passes ? "pass" : "FAIL"} |`,
    );
  }
  lines.push("", "| Venue | Archived responses | Rate-limited attempts | Unavailable attempts |", "|---|---|---|---|");
  for (const v of check.venues) lines.push(`| ${v.venue} | ${v.responses} | ${v.rateLimitedAttempts} | ${v.unavailableAttempts} |`);
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("feed-check.ts")) {
  const days = Number(process.argv[2] ?? 7);
  if (!Number.isFinite(days) || days <= 0) throw new Error("usage: feed-check.ts [days]");
  const to = Math.floor(Date.now() / 60_000) * 60;
  console.log(renderFeedCheck(await feedCheck(to - Math.round(days * 86_400), to)));
  await pool.end();
}
