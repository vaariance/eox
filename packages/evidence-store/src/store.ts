import { pool } from "./db.js";
import type { NewObservation, Observation, Query } from "./types.js";

const COLUMNS = `
  id::text, country_iso3 AS "countryIso3", indicator_id AS "indicatorId",
  to_char(period_start, 'YYYY-MM-DD') AS "periodStart",
  to_char(period_end,   'YYYY-MM-DD') AS "periodEnd",
  value::text AS value, source_id AS "sourceId", vintage,
  published_at AS "publishedAt", known_at AS "knownAt",
  recipe_id AS "recipeId", raw_sha256 AS "rawSha256",
  supersedes_id::text AS "supersedesId", correction_reason AS "correctionReason"`;

export async function recordObservation(o: NewObservation): Promise<Observation> {
  return insert(o, null, null);
}

export async function recordCorrection(
  badObservationId: string,
  fixed: NewObservation,
  reason: string,
): Promise<Observation> {
  if (!reason.trim()) throw new Error("A correction needs a reason.");
  return insert(fixed, badObservationId, reason);
}

async function insert(
  o: NewObservation,
  supersedesId: string | null,
  reason: string | null,
): Promise<Observation> {
  const { rows } = await pool.query(
    `INSERT INTO observations
       (country_iso3, indicator_id, period_start, period_end, value, source_id,
        vintage, published_at, known_at, recipe_id, raw_sha256,
        supersedes_id, correction_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::timestamptz, now()), $10,$11,$12,$13)
     RETURNING ${COLUMNS}`,
    [
      o.countryIso3, o.indicatorId, o.periodStart, o.periodEnd, String(o.value),
      o.sourceId, o.vintage, o.publishedAt, o.knownAt ?? null,
      o.recipeId ?? null, o.rawSha256 ?? null, supersedesId, reason,
    ],
  );
  return rows[0];
}

export async function getAsOf(q: Query, asOf: Date | string): Promise<Observation[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (period_start, period_end, source_id) ${COLUMNS}
       FROM observations
      WHERE country_iso3 = $1
        AND indicator_id = $2
        AND ($3::text IS NULL OR source_id = $3)
        AND known_at <= $4
      ORDER BY period_start, period_end, source_id, known_at DESC, observations.id DESC`,
    [q.countryIso3, q.indicatorId, q.sourceId ?? null, asOf],
  );
  return rows;
}

export async function getLatest(q: Query): Promise<Observation[]> {
  return getAsOf(q, new Date());
}

export async function getHistory(q: Query, periodStart: string): Promise<Observation[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
       FROM observations
      WHERE country_iso3 = $1 AND indicator_id = $2
        AND ($3::text IS NULL OR source_id = $3)
        AND period_start = $4
      ORDER BY known_at, observations.id`,
    [q.countryIso3, q.indicatorId, q.sourceId ?? null, periodStart],
  );
  return rows;
}
