ALTER TABLE observations
  ADD COLUMN revises_id BIGINT REFERENCES observations(id),
  ADD CONSTRAINT observations_revision_not_self CHECK (revises_id IS NULL OR revises_id <> id);

CREATE FUNCTION check_revision_link() RETURNS trigger AS $$
DECLARE
  previous observations%ROWTYPE;
BEGIN
  IF NEW.revises_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO previous FROM observations WHERE id = NEW.revises_id;
  IF previous.country_iso3 <> NEW.country_iso3
     OR previous.indicator_id <> NEW.indicator_id
     OR previous.source_id <> NEW.source_id
     OR previous.period_start <> NEW.period_start
     OR previous.period_end <> NEW.period_end THEN
    RAISE EXCEPTION 'revision % must revise the same series and period', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER observations_check_revision_link
  BEFORE INSERT ON observations
  FOR EACH ROW EXECUTE FUNCTION check_revision_link();

CREATE INDEX observations_revises ON observations (revises_id) WHERE revises_id IS NOT NULL;
