ALTER TABLE snapshots
  ALTER COLUMN snapshot_digest DROP NOT NULL,
  ADD COLUMN digest_encoding TEXT CHECK (digest_encoding = 'COX/WIRE/V1'),
  ADD CONSTRAINT snapshots_admissible_has_digest CHECK (NOT admissible OR snapshot_digest IS NOT NULL),
  ADD CONSTRAINT snapshots_digest_has_encoding CHECK ((snapshot_digest IS NULL) = (digest_encoding IS NULL)) NOT VALID;
