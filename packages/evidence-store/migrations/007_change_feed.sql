ALTER TABLE observations
  ADD COLUMN inserted_xid xid8 NOT NULL DEFAULT pg_current_xact_id();

CREATE FUNCTION stamp_inserted_xid() RETURNS trigger AS $$
BEGIN
  NEW.inserted_xid := pg_current_xact_id();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER observations_stamp_inserted_xid
  BEFORE INSERT ON observations
  FOR EACH ROW EXECUTE FUNCTION stamp_inserted_xid();

CREATE INDEX observations_change_feed ON observations (inserted_xid, id);
