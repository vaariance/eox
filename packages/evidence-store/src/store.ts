import { createHash } from "node:crypto";
import { pool } from "./db.js";
import type {
  ChangeCursor,
  ChangePage,
  NewObservation,
  NewSourcePayload,
  Observation,
  Query,
  SourcePayload,
  StoredPayload,
} from "./types.js";

const COLUMNS = `
  id::text, country_iso3 AS "countryIso3", indicator_id AS "indicatorId",
  to_char(period_start, 'YYYY-MM-DD') AS "periodStart",
  to_char(period_end,   'YYYY-MM-DD') AS "periodEnd",
  value::text AS value, source_id AS "sourceId", vintage,
  published_at AS "publishedAt", known_at AS "knownAt", recorded_at AS "recordedAt",
  recipe_id AS "recipeId", raw_sha256 AS "rawSha256", raw_value AS "rawValue",
  coverage_reported AS "coverageReported", coverage_total AS "coverageTotal",
  revises_id::text AS "revisesId",
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
        vintage, published_at, known_at, recipe_id, raw_sha256, raw_value,
        coverage_reported, coverage_total, revises_id, supersedes_id, correction_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::timestamptz, now()), $10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING ${COLUMNS}`,
    [
      o.countryIso3, o.indicatorId, o.periodStart, o.periodEnd, String(o.value),
      o.sourceId, o.vintage, o.publishedAt ?? null, o.knownAt ?? null,
      o.recipeId ?? null, o.rawSha256 ?? null, o.rawValue ?? null,
      o.coverageReported ?? null, o.coverageTotal ?? null, o.revisesId ?? null, supersedesId, reason,
    ],
  );
  return rows[0];
}

const PAYLOAD_COLUMNS = `
  sha256, source_id AS "sourceId", request_url AS "requestUrl", http_status AS "httpStatus",
  content_type AS "contentType", recorded_at AS "recordedAt"`;

export async function recordSourcePayload(p: NewSourcePayload): Promise<SourcePayload> {
  const body = Buffer.from(p.body);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const inserted = await pool.query(
    `INSERT INTO source_payloads (sha256, source_id, request_url, http_status, content_type, body)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (sha256) DO NOTHING
     RETURNING ${PAYLOAD_COLUMNS}`,
    [sha256, p.sourceId, p.requestUrl, p.httpStatus, p.contentType, body],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const existing = await pool.query(`SELECT ${PAYLOAD_COLUMNS} FROM source_payloads WHERE sha256 = $1`, [sha256]);
  if (!existing.rows[0]) throw new Error(`source payload ${sha256} was neither inserted nor found`);
  return existing.rows[0];
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

export async function getVersions(q: Query): Promise<Observation[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
       FROM observations
      WHERE country_iso3 = $1 AND indicator_id = $2
        AND ($3::text IS NULL OR source_id = $3)
      ORDER BY period_start, period_end, known_at, observations.id`,
    [q.countryIso3, q.indicatorId, q.sourceId ?? null],
  );
  return rows;
}

export async function readChanges(after: ChangeCursor | null, limit: number): Promise<ChangePage> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`invalid change page limit: ${limit}`);
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}, inserted_xid::text AS "insertedXid"
       FROM observations
      WHERE inserted_xid < pg_snapshot_xmin(pg_current_snapshot())
        AND ($1::xid8 IS NULL OR (inserted_xid, id) > ($1::xid8, $2::bigint))
      ORDER BY inserted_xid, observations.id
      LIMIT $3`,
    [after?.xid ?? null, after?.id ?? null, limit],
  );
  const last = rows.at(-1);
  const observations = rows.map(({ insertedXid: _insertedXid, ...observation }) => observation as Observation);
  return { observations, cursor: last ? { xid: last.insertedXid, id: last.id } : after };
}

export async function getObservation(id: string): Promise<Observation | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM observations WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getSourcePayload(sha256: string): Promise<StoredPayload | null> {
  const { rows } = await pool.query(
    `SELECT sha256, content_type AS "contentType", body FROM source_payloads WHERE sha256 = $1`,
    [sha256],
  );
  return rows[0] ?? null;
}

