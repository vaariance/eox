INSERT INTO sources (id, name, country_iso3, provenance_class, redistributable, url) VALUES
  ('pyth-hermes', 'Pyth Network Hermes price service', NULL, 'licensed_commercial', false, 'https://pyth.dourolabs.app/hermes');

CREATE TABLE assets (
  asset_id    TEXT PRIMARY KEY CHECK (asset_id ~ '^[A-Z0-9]{2,12}$'),
  feed_id     TEXT NOT NULL UNIQUE CHECK (feed_id ~ '^[0-9a-f]{64}$'),
  symbol      TEXT NOT NULL CHECK (length(symbol) BETWEEN 1 AND 64),
  quote       TEXT NOT NULL CHECK (quote ~ '^[A-Z]{3}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, feed_id)
);

CREATE TABLE price_updates (
  id          BIGSERIAL PRIMARY KEY,
  cutoff      BIGINT NOT NULL UNIQUE CHECK (cutoff > 0 AND cutoff % 60 = 0),
  raw_sha256  TEXT NOT NULL REFERENCES source_payloads(sha256),
  feed_ids    TEXT[] NOT NULL CHECK (cardinality(feed_ids) >= 1),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE price_observations (
  id                BIGSERIAL PRIMARY KEY,
  price_update_id   BIGINT NOT NULL REFERENCES price_updates(id),
  asset_id          TEXT NOT NULL,
  feed_id           TEXT NOT NULL,
  cutoff            BIGINT NOT NULL,
  price             TEXT NOT NULL CHECK (price ~ '^-?(0|[1-9][0-9]{0,18})$'),
  conf              TEXT NOT NULL CHECK (conf ~ '^(0|[1-9][0-9]{0,19})$'),
  expo              INT NOT NULL,
  publish_time      BIGINT NOT NULL CHECK (publish_time > 0),
  prev_publish_time BIGINT NOT NULL CHECK (prev_publish_time >= 0),
  raw_sha256        TEXT NOT NULL REFERENCES source_payloads(sha256),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  admissible        BOOLEAN NOT NULL,
  rejection         TEXT CHECK (rejection IN
                      ('outside_window', 'unsynchronised', 'exponent_mismatch', 'non_positive_price', 'confidence_bound')),
  inserted_xid      xid8 NOT NULL DEFAULT pg_current_xact_id(),
  FOREIGN KEY (asset_id, feed_id) REFERENCES assets(asset_id, feed_id),
  UNIQUE (cutoff, asset_id),
  CHECK (admissible = (rejection IS NULL))
);

CREATE TABLE incidents (
  id          BIGSERIAL PRIMARY KEY,
  cutoff      BIGINT NOT NULL CHECK (cutoff > 0 AND cutoff % 60 = 0),
  kind        TEXT NOT NULL CHECK (kind IN
                ('fetch_failed', 'decode_failed', 'missing_feed', 'unexpected_feed', 'inadmissible_snapshot')),
  detail      TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 2000),
  raw_sha256  TEXT REFERENCES source_payloads(sha256),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION check_price_observation_update() RETURNS trigger AS $$
DECLARE
  parent price_updates%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM price_updates WHERE id = NEW.price_update_id;
  IF parent.cutoff <> NEW.cutoff OR parent.raw_sha256 <> NEW.raw_sha256 OR NOT (NEW.feed_id = ANY (parent.feed_ids)) THEN
    RAISE EXCEPTION 'price observation does not match its price update';
  END IF;
  NEW.inserted_xid := pg_current_xact_id();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER price_observations_match_update
  BEFORE INSERT ON price_observations
  FOR EACH ROW EXECUTE FUNCTION check_price_observation_update();

CREATE INDEX price_observations_change_feed ON price_observations (inserted_xid, id);
CREATE INDEX incidents_cutoff ON incidents (cutoff);

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['assets', 'price_updates', 'price_observations', 'incidents'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION stamp_recorded_at()', tbl || '_stamp_recorded_at', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation()', tbl || '_no_update_delete', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_append_only_mutation()', tbl || '_no_truncate', tbl);
  END LOOP;
END;
$$;
