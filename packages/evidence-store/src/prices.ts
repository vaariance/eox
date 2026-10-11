import { pool } from "./db.js";
import type {
  Asset,
  AssetResolution,
  ChangeCursor,
  CutoffRecord,
  Incident,
  NewAsset,
  NewAssetResolution,
  NewIncident,
  NewSnapshot,
  NewVenueResponse,
  Snapshot,
  SnapshotChangePage,
  VenueResponse,
} from "./types.js";

const ASSET_COLUMNS = `
  asset_id AS "assetId", position, kraken_ws_symbol AS "krakenWsSymbol", kraken_rest_pair AS "krakenRestPair",
  coinbase_product AS "coinbaseProduct", bybit_symbol AS "bybitSymbol", recorded_at AS "recordedAt"`;

const RESPONSE_COLUMNS = `
  id::text, venue, asset_id AS "assetId", cutoff::float8 AS cutoff, request, raw_sha256 AS "rawSha256",
  recorded_at AS "recordedAt"`;

const ATTEMPT_COLUMNS = `
  id::text, asset_id AS "assetId", cutoff::float8 AS cutoff, venue, step, outcome, raw_sha256 AS "rawSha256",
  recorded_at AS "recordedAt"`;

const OBSERVATION_COLUMNS = `
  price_observations.id::text, asset_id AS "assetId", cutoff::float8 AS cutoff, venue, step,
  candle_start::float8 AS "candleStart", close, usdt_usd AS "usdtUsd", usdt_raw_sha256 AS "usdtRawSha256",
  price_e8 AS "priceE8", trade_evidence AS "tradeEvidence", trade_age_minutes AS "tradeAgeMinutes",
  raw_sha256 AS "rawSha256", admissible, rejection, price_observations.recorded_at AS "recordedAt"`;

const SNAPSHOT_COLUMNS = `
  snapshots.id::text, cutoff::float8 AS cutoff, observation_ids::text[] AS "observationIds",
  snapshot_digest AS "snapshotDigest", digest_encoding AS "digestEncoding", admissible, recorded_at AS "recordedAt"`;

const INCIDENT_COLUMNS = `
  id::text, cutoff::float8 AS cutoff, kind, asset_id AS "assetId", venue, detail, raw_sha256 AS "rawSha256",
  recorded_at AS "recordedAt"`;

export async function registerAsset(asset: NewAsset): Promise<Asset> {
  const inserted = await pool.query(
    `INSERT INTO assets (asset_id, position, kraken_ws_symbol, kraken_rest_pair, coinbase_product, bybit_symbol)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING ${ASSET_COLUMNS}`,
    [asset.assetId, asset.position, asset.krakenWsSymbol, asset.krakenRestPair, asset.coinbaseProduct, asset.bybitSymbol],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const { rows } = await pool.query(`SELECT ${ASSET_COLUMNS} FROM assets WHERE asset_id = $1`, [asset.assetId]);
  const existing = rows[0] as Asset | undefined;
  if (
    !existing ||
    existing.position !== asset.position ||
    existing.krakenWsSymbol !== asset.krakenWsSymbol ||
    existing.krakenRestPair !== asset.krakenRestPair ||
    existing.coinbaseProduct !== asset.coinbaseProduct ||
    existing.bybitSymbol !== asset.bybitSymbol
  ) {
    throw new Error(`asset ${asset.assetId} conflicts with an asset already registered`);
  }
  return existing;
}

export async function getAssets(): Promise<Asset[]> {
  const { rows } = await pool.query(`SELECT ${ASSET_COLUMNS} FROM assets ORDER BY position`);
  return rows;
}

export async function recordVenueResponse(response: NewVenueResponse): Promise<VenueResponse> {
  const inserted = await pool.query(
    `INSERT INTO venue_responses (venue, asset_id, cutoff, request, raw_sha256) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING ${RESPONSE_COLUMNS}`,
    [response.venue, response.assetId, response.cutoff, response.request, response.rawSha256],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const { rows } = await pool.query(
    `SELECT ${RESPONSE_COLUMNS} FROM venue_responses WHERE venue = $1 AND asset_id = $2 AND cutoff = $3 AND raw_sha256 = $4`,
    [response.venue, response.assetId, response.cutoff, response.rawSha256],
  );
  return rows[0];
}

export async function recordAssetResolution(resolution: NewAssetResolution): Promise<AssetResolution> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const attempts = [];
    for (const attempt of resolution.attempts) {
      const { rows } = await client.query(
        `INSERT INTO venue_attempts (asset_id, cutoff, venue, step, outcome, raw_sha256) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${ATTEMPT_COLUMNS}`,
        [resolution.assetId, resolution.cutoff, attempt.venue, attempt.step, attempt.outcome, attempt.rawSha256],
      );
      attempts.push(rows[0]);
    }
    let observation = null;
    const o = resolution.observation;
    if (o) {
      const { rows } = await client.query(
        `INSERT INTO price_observations
           (asset_id, cutoff, venue, step, candle_start, close, usdt_usd, usdt_raw_sha256, price_e8, trade_evidence,
            trade_age_minutes, raw_sha256, admissible, rejection)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING ${OBSERVATION_COLUMNS}`,
        [resolution.assetId, resolution.cutoff, o.venue, o.step, o.candleStart, o.close, o.usdtUsd, o.usdtRawSha256,
          o.priceE8, o.tradeEvidence, o.tradeAgeMinutes, o.rawSha256, o.rejection === null, o.rejection],
      );
      observation = rows[0];
    }
    await client.query("COMMIT");
    return { attempts, observation };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordSnapshot(snapshot: NewSnapshot): Promise<Snapshot> {
  const { rows } = await pool.query(
    `INSERT INTO snapshots (cutoff, observation_ids, snapshot_digest, digest_encoding, admissible) VALUES ($1, $2::bigint[], $3, $4, $5)
     RETURNING ${SNAPSHOT_COLUMNS}`,
    [snapshot.cutoff, snapshot.observationIds, snapshot.snapshotDigest, snapshot.snapshotDigest === null ? null : "COX/WIRE/V1", snapshot.admissible],
  );
  return rows[0];
}

export async function recordIncident(incident: NewIncident): Promise<Incident> {
  const { rows } = await pool.query(
    `INSERT INTO incidents (cutoff, kind, asset_id, venue, detail, raw_sha256) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${INCIDENT_COLUMNS}`,
    [incident.cutoff, incident.kind, incident.assetId, incident.venue, incident.detail, incident.rawSha256],
  );
  return rows[0];
}

export async function getCutoff(cutoff: number): Promise<CutoffRecord> {
  const [snapshot, observations, attempts, responses, incidents] = await Promise.all([
    pool.query(`SELECT ${SNAPSHOT_COLUMNS} FROM snapshots WHERE cutoff = $1`, [cutoff]),
    pool.query(
      `SELECT ${OBSERVATION_COLUMNS} FROM price_observations JOIN assets USING (asset_id) WHERE cutoff = $1 ORDER BY assets.position`,
      [cutoff],
    ),
    pool.query(`SELECT ${ATTEMPT_COLUMNS} FROM venue_attempts WHERE cutoff = $1 ORDER BY asset_id, step`, [cutoff]),
    pool.query(`SELECT ${RESPONSE_COLUMNS} FROM venue_responses WHERE cutoff = $1 ORDER BY venue_responses.id`, [cutoff]),
    pool.query(`SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE cutoff = $1 ORDER BY incidents.id`, [cutoff]),
  ]);
  return {
    cutoff,
    snapshot: snapshot.rows[0] ?? null,
    observations: observations.rows,
    attempts: attempts.rows,
    responses: responses.rows,
    incidents: incidents.rows,
  };
}

export async function getLatestSnapshotCutoff(): Promise<number | null> {
  const { rows } = await pool.query(`SELECT max(cutoff)::float8 AS cutoff FROM snapshots`);
  return rows[0].cutoff;
}

export async function readSnapshotChanges(after: ChangeCursor | null, limit: number): Promise<SnapshotChangePage> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`invalid change page limit: ${limit}`);
  const { rows } = await pool.query(
    `SELECT ${SNAPSHOT_COLUMNS}, inserted_xid::text AS "insertedXid"
       FROM snapshots
      WHERE inserted_xid < pg_snapshot_xmin(pg_current_snapshot())
        AND ($1::xid8 IS NULL OR (inserted_xid, snapshots.id) > ($1::xid8, $2::bigint))
      ORDER BY inserted_xid, snapshots.id
      LIMIT $3`,
    [after?.xid ?? null, after?.id ?? null, limit],
  );
  const last = rows.at(-1);
  const snapshots = rows.map(({ insertedXid: _insertedXid, ...snapshot }) => snapshot as Snapshot);
  return { snapshots, cursor: last ? { xid: last.insertedXid, id: last.id } : after };
}
