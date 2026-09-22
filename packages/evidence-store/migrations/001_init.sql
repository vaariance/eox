CREATE TABLE sources (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  country_iso3     CHAR(3),
  provenance_class TEXT NOT NULL CHECK (provenance_class IN
                     ('official', 'official_adjacent', 'licensed_commercial', 'derived')),
  redistributable  BOOLEAN NOT NULL DEFAULT false,
  url              TEXT
);

CREATE TABLE indicators (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  unit      TEXT NOT NULL,
  dimension TEXT NOT NULL
);

CREATE TABLE recipes (
  id          SERIAL PRIMARY KEY,
  description JSONB NOT NULL,
  code_hash   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE observations (
  id                BIGSERIAL PRIMARY KEY,
  country_iso3      CHAR(3) NOT NULL CHECK (country_iso3 ~ '^[A-Z]{3}$'),
  indicator_id      TEXT NOT NULL REFERENCES indicators(id),

  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,

  value             NUMERIC(20, 6) NOT NULL,

  source_id         TEXT NOT NULL REFERENCES sources(id),
  vintage           TEXT NOT NULL,
  published_at      TIMESTAMPTZ NOT NULL,

  known_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  recipe_id         INT REFERENCES recipes(id),
  raw_sha256        TEXT,

  supersedes_id     BIGINT REFERENCES observations(id),
  correction_reason TEXT,

  CHECK (period_end >= period_start),
  CHECK ((supersedes_id IS NULL) = (correction_reason IS NULL)),
  UNIQUE (country_iso3, indicator_id, period_start, period_end, source_id, known_at)
);

CREATE INDEX observations_lookup
  ON observations (country_iso3, indicator_id, period_start, known_at DESC);

CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'observations are append-only: % is not allowed. Insert a correction row instead.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER observations_no_update_delete
  BEFORE UPDATE OR DELETE ON observations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER observations_no_truncate
  BEFORE TRUNCATE ON observations
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

INSERT INTO indicators (id, name, unit, dimension) VALUES
  ('gdp_real_growth_yoy', 'Real GDP growth, year on year', 'percent', 'E'),
  ('cpi_core_yoy',        'Core CPI inflation, year on year', 'percent', 'E'),
  ('unemployment_rate',   'Unemployment rate', 'percent', 'E'),
  ('policy_rate',         'Central bank policy rate', 'percent', 'E'),
  ('fiscal_deficit_gdp',  'Fiscal deficit, share of GDP', 'percent', 'E');

INSERT INTO sources (id, name, country_iso3, provenance_class, redistributable, url) VALUES
  ('nbs-ng',  'National Bureau of Statistics (Nigeria)', 'NGA', 'official', true, 'https://nigerianstat.gov.ng'),
  ('cbn-ng',  'Central Bank of Nigeria',                 'NGA', 'official', true, 'https://www.cbn.gov.ng'),
  ('bea-us',  'Bureau of Economic Analysis (US)',        'USA', 'official', true, 'https://www.bea.gov'),
  ('bls-us',  'Bureau of Labor Statistics (US)',         'USA', 'official', true, 'https://www.bls.gov'),
  ('fed-us',  'US Federal Reserve',                      'USA', 'official', true, 'https://www.federalreserve.gov'),
  ('nbs-cn',  'National Bureau of Statistics of China',  'CHN', 'official', true, 'https://www.stats.gov.cn'),
  ('pboc-cn', 'People''s Bank of China',                 'CHN', 'official', true, 'http://www.pbc.gov.cn'),
  ('mospi-in','Ministry of Statistics (India)',          'IND', 'official', true, 'https://mospi.gov.in'),
  ('rbi-in',  'Reserve Bank of India',                   'IND', 'official', true, 'https://www.rbi.org.in'),
  ('imf',     'International Monetary Fund',             NULL,  'official', true, 'https://data.imf.org');
