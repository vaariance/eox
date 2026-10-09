CREATE TABLE source_releases (
  id                BIGSERIAL PRIMARY KEY,
  source_id         TEXT NOT NULL REFERENCES sources(id),
  dataset           TEXT NOT NULL,
  released_at       TIMESTAMPTZ NOT NULL,
  latest_period     DATE NOT NULL,
  metadata_sha256   TEXT NOT NULL REFERENCES source_payloads(sha256),
  periods_sha256    TEXT NOT NULL REFERENCES source_payloads(sha256),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, dataset, released_at)
);

CREATE TRIGGER source_releases_stamp_recorded_at
  BEFORE INSERT ON source_releases
  FOR EACH ROW EXECUTE FUNCTION stamp_recorded_at();

CREATE TRIGGER source_releases_no_update_delete
  BEFORE UPDATE OR DELETE ON source_releases
  FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation();

CREATE TRIGGER source_releases_no_truncate
  BEFORE TRUNCATE ON source_releases
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_append_only_mutation();

ALTER TABLE observations
  ADD COLUMN release_id BIGINT REFERENCES source_releases(id),
  ADD CONSTRAINT observations_release_has_publication CHECK (release_id IS NULL OR published_at IS NOT NULL);

ALTER TABLE observations
  ADD CONSTRAINT observations_publication_needs_release CHECK (published_at IS NULL OR release_id IS NOT NULL) NOT VALID;

CREATE FUNCTION check_release_link() RETURNS trigger AS $$
DECLARE
  release source_releases%ROWTYPE;
BEGIN
  IF NEW.release_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO release FROM source_releases WHERE id = NEW.release_id;
  IF release.source_id <> NEW.source_id OR release.released_at <> NEW.published_at THEN
    RAISE EXCEPTION 'observation publication time must equal its linked % release', release.source_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER observations_check_release_link
  BEFORE INSERT ON observations
  FOR EACH ROW EXECUTE FUNCTION check_release_link();
