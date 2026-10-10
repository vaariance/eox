import { pool } from "./db.js";
import type {
  Asset,
  ChangeCursor,
  Incident,
  NewIncident,
  NewPriceUpdate,
  PriceChangePage,
  PriceObservation,
  PriceUpdate,
} from "./types.js";

const ASSET_COLUMNS = `asset_id AS "assetId", feed_id AS "feedId", symbol, quote, recorded_at AS "recordedAt"`;

const OBSERVATION_COLUMNS = `
  price_observations.id::text, price_update_id::text AS "priceUpdateId", asset_id AS "assetId",
  feed_id AS "feedId", cutoff::float8 AS cutoff, price, conf, expo,
  publish_time::float8 AS "publishTime", prev_publish_time::float8 AS "prevPublishTime",
  raw_sha256 AS "rawSha256", recorded_at AS "recordedAt", admissible, rejection`;

const UPDATE_COLUMNS = `id::text, cutoff::float8 AS cutoff, raw_sha256 AS "rawSha256", feed_ids AS "feedIds", recorded_at AS "recordedAt"`;

const INCIDENT_COLUMNS = `id::text, cutoff::float8 AS cutoff, kind, detail, raw_sha256 AS "rawSha256", recorded_at AS "recordedAt"`;

export async function registerAsset(asset: Omit<Asset, "recordedAt">): Promise<Asset> {
  const inserted = await pool.query(
    `INSERT INTO assets (asset_id, feed_id, symbol, quote) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING ${ASSET_COLUMNS}`,
    [asset.assetId, asset.feedId, asset.symbol, asset.quote],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const { rows } = await pool.query(`SELECT ${ASSET_COLUMNS} FROM assets WHERE asset_id = $1`, [asset.assetId]);
  const existing = rows[0] as Asset | undefined;
  if (!existing || existing.feedId !== asset.feedId || existing.symbol !== asset.symbol || existing.quote !== asset.quote) {
    throw new Error(`asset ${asset.assetId} or feed ${asset.feedId} is already registered with a different identity`);
  }
  return existing;
}

export async function getAssets(): Promise<Asset[]> {
  const { rows } = await pool.query(`SELECT ${ASSET_COLUMNS} FROM assets ORDER BY asset_id`);
  return rows;
}

export async function recordPriceUpdate(update: NewPriceUpdate): Promise<PriceUpdate> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO price_updates (cutoff, raw_sha256, feed_ids) VALUES ($1, $2, $3) RETURNING ${UPDATE_COLUMNS}`,
      [update.cutoff, update.rawSha256, update.feedIds],
    );
    const parent = inserted.rows[0];
    const observations: PriceObservation[] = [];
    for (const o of update.observations) {
      const { rows } = await client.query(
        `INSERT INTO price_observations
           (price_update_id, asset_id, feed_id, cutoff, price, conf, expo, publish_time, prev_publish_time,
            raw_sha256, admissible, rejection)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${OBSERVATION_COLUMNS}`,
        [parent.id, o.assetId, o.feedId, update.cutoff, o.price, o.conf, o.expo, o.publishTime, o.prevPublishTime,
          update.rawSha256, o.rejection === null, o.rejection],
      );
      observations.push(rows[0]);
    }
    await client.query("COMMIT");
    return { ...parent, observations };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPriceUpdate(cutoff: number): Promise<PriceUpdate | null> {
  const { rows } = await pool.query(`SELECT ${UPDATE_COLUMNS} FROM price_updates WHERE cutoff = $1`, [cutoff]);
  if (!rows[0]) return null;
  const observations = await pool.query(
    `SELECT ${OBSERVATION_COLUMNS} FROM price_observations WHERE price_update_id = $1 ORDER BY asset_id`,
    [rows[0].id],
  );
  return { ...rows[0], observations: observations.rows };
}

export async function getLatestPriceCutoff(): Promise<number | null> {
  const { rows } = await pool.query(`SELECT max(cutoff)::float8 AS cutoff FROM price_updates`);
  return rows[0].cutoff;
}

export async function recordIncident(incident: NewIncident): Promise<Incident> {
  const { rows } = await pool.query(
    `INSERT INTO incidents (cutoff, kind, detail, raw_sha256) VALUES ($1, $2, $3, $4) RETURNING ${INCIDENT_COLUMNS}`,
    [incident.cutoff, incident.kind, incident.detail, incident.rawSha256],
  );
  return rows[0];
}

export async function getIncidents(cutoff: number): Promise<Incident[]> {
  const { rows } = await pool.query(`SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE cutoff = $1 ORDER BY incidents.id`, [cutoff]);
  return rows;
}

export async function readPriceChanges(after: ChangeCursor | null, limit: number): Promise<PriceChangePage> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`invalid change page limit: ${limit}`);
  const { rows } = await pool.query(
    `SELECT ${OBSERVATION_COLUMNS}, inserted_xid::text AS "insertedXid"
       FROM price_observations
      WHERE inserted_xid < pg_snapshot_xmin(pg_current_snapshot())
        AND ($1::xid8 IS NULL OR (inserted_xid, price_observations.id) > ($1::xid8, $2::bigint))
      ORDER BY inserted_xid, price_observations.id
      LIMIT $3`,
    [after?.xid ?? null, after?.id ?? null, limit],
  );
  const last = rows.at(-1);
  const observations = rows.map(({ insertedXid: _insertedXid, ...observation }) => observation as PriceObservation);
  return { observations, cursor: last ? { xid: last.insertedXid, id: last.id } : after };
}
