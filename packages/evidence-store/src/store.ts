import { createHash } from "node:crypto";
import { pool } from "./db.js";
import type { NewSourcePayload, SourcePayload, StoredPayload } from "./types.js";

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

export async function getSourcePayload(sha256: string): Promise<StoredPayload | null> {
  const { rows } = await pool.query(
    `SELECT sha256, content_type AS "contentType", body FROM source_payloads WHERE sha256 = $1`,
    [sha256],
  );
  return rows[0] ?? null;
}
