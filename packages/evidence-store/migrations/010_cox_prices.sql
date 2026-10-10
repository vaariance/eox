INSERT INTO sources (id, name, country_iso3, provenance_class, redistributable, url) VALUES
  ('kraken',   'Kraken public market data',   NULL, 'licensed_commercial', false, 'https://api.kraken.com'),
  ('coinbase', 'Coinbase Exchange market data', NULL, 'licensed_commercial', false, 'https://api.exchange.coinbase.com'),
  ('bybit',    'Bybit public market data',    NULL, 'licensed_commercial', false, 'https://api.bybit.com');

CREATE TABLE assets (
  asset_id         TEXT PRIMARY KEY CHECK (asset_id ~ '^[A-Z0-9]{1,12}$' AND asset_id <> 'USDT'),
  position         INT NOT NULL UNIQUE CHECK (position >= 0),
  kraken_ws_symbol TEXT NOT NULL UNIQUE CHECK (kraken_ws_symbol ~ '^[A-Z0-9]{1,12}/USD$'),
  kraken_rest_pair TEXT NOT NULL UNIQUE CHECK (kraken_rest_pair ~ '^[A-Z0-9]{2,16}$'),
  coinbase_product TEXT UNIQUE CHECK (coinbase_product ~ '^[A-Z0-9]{1,12}-USD$'),
  bybit_symbol     TEXT UNIQUE CHECK (bybit_symbol ~ '^[A-Z0-9]{1,12}USDT$'),
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE venue_responses (
  id          BIGSERIAL PRIMARY KEY,
  venue       TEXT NOT NULL CHECK (venue IN ('kraken', 'coinbase', 'bybit')),
  asset_id    TEXT NOT NULL CHECK (asset_id ~ '^[A-Z0-9]{1,12}$'),
  cutoff      BIGINT NOT NULL CHECK (cutoff > 0 AND cutoff % 60 = 0),
  request     TEXT NOT NULL CHECK (length(request) BETWEEN 1 AND 2000),
  raw_sha256  TEXT NOT NULL REFERENCES source_payloads(sha256),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue, asset_id, cutoff, raw_sha256)
);

CREATE TABLE venue_attempts (
  id          BIGSERIAL PRIMARY KEY,
  asset_id    TEXT NOT NULL CHECK (asset_id ~ '^[A-Z0-9]{1,12}$'),
  cutoff      BIGINT NOT NULL CHECK (cutoff > 0 AND cutoff % 60 = 0),
  venue       TEXT NOT NULL CHECK (venue IN ('kraken', 'coinbase', 'bybit')),
  step        INT NOT NULL CHECK (step BETWEEN 1 AND 4),
  outcome     TEXT NOT NULL CHECK (outcome IN ('trades', 'empty', 'not-listed', 'unavailable', 'rate-limited', 'malformed')),
  raw_sha256  TEXT REFERENCES source_payloads(sha256),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, cutoff, step)
);

CREATE TABLE price_observations (
  id                BIGSERIAL PRIMARY KEY,
  asset_id          TEXT NOT NULL REFERENCES assets(asset_id),
  cutoff            BIGINT NOT NULL CHECK (cutoff > 0 AND cutoff % 60 = 0),
  venue             TEXT NOT NULL CHECK (venue IN ('kraken', 'coinbase', 'bybit')),
  step              INT NOT NULL CHECK (step BETWEEN 1 AND 4),
  candle_start      BIGINT NOT NULL CHECK (candle_start > 0 AND candle_start % 60 = 0),
  close             TEXT NOT NULL CHECK (close ~ '^-?[0-9]+(\.[0-9]+)?$'),
  usdt_usd          TEXT CHECK (usdt_usd ~ '^[0-9]+(\.[0-9]+)?$'),
  usdt_raw_sha256   TEXT REFERENCES source_payloads(sha256),
  price_e8          TEXT CHECK (price_e8 ~ '^-?(0|[1-9][0-9]{0,18})$'),
  trade_evidence    TEXT NOT NULL CHECK (trade_evidence ~ '^[0-9]+(\.[0-9]+)?$'),
  trade_age_minutes INT NOT NULL CHECK (trade_age_minutes >= 0),
  raw_sha256        TEXT NOT NULL REFERENCES source_payloads(sha256),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  admissible        BOOLEAN NOT NULL,
  rejection         TEXT CHECK (rejection IN ('non_positive_price', 'excess_decimals', 'trade_age_exceeded')),
  UNIQUE (cutoff, asset_id),
  CHECK (admissible = (rejection IS NULL)),
  CHECK (admissible = false OR price_e8 IS NOT NULL),
  CHECK ((venue = 'bybit') = (usdt_usd IS NOT NULL)),
  CHECK ((usdt_usd IS NULL) = (usdt_raw_sha256 IS NULL)),
  CHECK (step < 4 OR venue = 'kraken'),
  CHECK ((step = 4) = (candle_start < cutoff - 60)),
  CHECK (step = 4 OR candle_start = cutoff - 60),
  CHECK (trade_age_minutes * 60 = cutoff - candle_start - 60)
);

CREATE TABLE snapshots (
  id              BIGSERIAL PRIMARY KEY,
  cutoff          BIGINT NOT NULL UNIQUE CHECK (cutoff > 0 AND cutoff % 60 = 0),
  observation_ids BIGINT[] NOT NULL,
  snapshot_digest TEXT NOT NULL CHECK (snapshot_digest ~ '^[0-9a-f]{64}$'),
  admissible      BOOLEAN NOT NULL,
  CHECK (cardinality(observation_ids) >= 1 OR NOT admissible),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  inserted_xid    xid8 NOT NULL DEFAULT pg_current_xact_id()
);

CREATE TABLE incidents (
  id          BIGSERIAL PRIMARY KEY,
  cutoff      BIGINT NOT NULL CHECK (cutoff > 0 AND cutoff % 60 = 0),
  kind        TEXT NOT NULL CHECK (kind IN
                ('venue_unavailable', 'venue_rate_limited', 'venue_malformed', 'asset_unresolved',
                 'asset_inadmissible', 'snapshot_inadmissible', 'archive_late', 'listing_changed', 'candle_revised')),
  asset_id    TEXT CHECK (asset_id ~ '^[A-Z0-9]{1,12}$'),
  venue       TEXT CHECK (venue IN ('kraken', 'coinbase', 'bybit')),
  detail      TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 2000),
  raw_sha256  TEXT REFERENCES source_payloads(sha256),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION check_snapshot_observations() RETURNS trigger AS $$
DECLARE
  matched INT;
  ordered BOOLEAN;
  all_admissible BOOLEAN;
BEGIN
  SELECT count(*), bool_and(o.admissible)
    INTO matched, all_admissible
    FROM unnest(NEW.observation_ids) AS ids(id)
    JOIN price_observations o ON o.id = ids.id AND o.cutoff = NEW.cutoff;
  IF matched <> cardinality(NEW.observation_ids)
     OR matched <> (SELECT count(DISTINCT x) FROM unnest(NEW.observation_ids) AS x) THEN
    RAISE EXCEPTION 'snapshot observations must be distinct observations of its cutoff';
  END IF;
  SELECT coalesce(bool_and(prev_position < position), true)
    INTO ordered
    FROM (
      SELECT a.position, lag(a.position) OVER (ORDER BY ids.ord) AS prev_position
        FROM unnest(NEW.observation_ids) WITH ORDINALITY AS ids(id, ord)
        JOIN price_observations o ON o.id = ids.id
        JOIN assets a ON a.asset_id = o.asset_id
    ) positions
   WHERE prev_position IS NOT NULL;
  IF NOT ordered THEN
    RAISE EXCEPTION 'snapshot observations must follow the canonical asset order';
  END IF;
  IF NEW.admissible AND NOT all_admissible THEN
    RAISE EXCEPTION 'an admissible snapshot cannot contain an inadmissible observation';
  END IF;
  NEW.inserted_xid := pg_current_xact_id();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER snapshots_check_observations
  BEFORE INSERT ON snapshots
  FOR EACH ROW EXECUTE FUNCTION check_snapshot_observations();

CREATE INDEX venue_responses_cutoff ON venue_responses (cutoff);
CREATE INDEX venue_attempts_cutoff ON venue_attempts (cutoff);
CREATE INDEX price_observations_cutoff ON price_observations (cutoff);
CREATE INDEX snapshots_change_feed ON snapshots (inserted_xid, id);
CREATE INDEX incidents_cutoff ON incidents (cutoff);

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['assets', 'venue_responses', 'venue_attempts', 'price_observations', 'snapshots', 'incidents'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION stamp_recorded_at()', tbl || '_stamp_recorded_at', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation()', tbl || '_no_update_delete', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_append_only_mutation()', tbl || '_no_truncate', tbl);
  END LOOP;
END;
$$;
