CREATE FUNCTION forbid_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed.', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION stamp_recorded_at() RETURNS trigger AS $$
BEGIN
  NEW.recorded_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE source_payloads (
  sha256       TEXT PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  source_id    TEXT NOT NULL REFERENCES sources(id),
  request_url  TEXT NOT NULL,
  http_status  INT NOT NULL,
  content_type TEXT,
  body         BYTEA NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sha256 = encode(sha256(body), 'hex'))
);

CREATE TRIGGER source_payloads_stamp_recorded_at
  BEFORE INSERT ON source_payloads
  FOR EACH ROW EXECUTE FUNCTION stamp_recorded_at();

CREATE TRIGGER source_payloads_no_update_delete
  BEFORE UPDATE OR DELETE ON source_payloads
  FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER source_payloads_no_truncate
  BEFORE TRUNCATE ON source_payloads
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_append_only_mutation();

ALTER TABLE observations
  ADD COLUMN recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN raw_value         TEXT,
  ADD COLUMN coverage_reported INT,
  ADD COLUMN coverage_total    INT,
  ALTER COLUMN published_at DROP NOT NULL,
  ADD CONSTRAINT observations_raw_payload_fk
    FOREIGN KEY (raw_sha256) REFERENCES source_payloads(sha256),
  ADD CONSTRAINT observations_coverage_check CHECK (
    (coverage_reported IS NULL AND coverage_total IS NULL)
    OR (coverage_reported >= 1 AND coverage_total >= coverage_reported)
  );

CREATE TRIGGER observations_stamp_recorded_at
  BEFORE INSERT ON observations
  FOR EACH ROW EXECUTE FUNCTION stamp_recorded_at();

CREATE INDEX observations_recorded_lookup
  ON observations (country_iso3, indicator_id, period_start, recorded_at DESC);
