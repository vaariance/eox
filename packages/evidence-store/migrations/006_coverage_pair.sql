ALTER TABLE observations
  DROP CONSTRAINT observations_coverage_check,
  ADD CONSTRAINT observations_coverage_check CHECK (
    (coverage_reported IS NULL AND coverage_total IS NULL)
    OR (
      coverage_reported IS NOT NULL
      AND coverage_total IS NOT NULL
      AND coverage_reported >= 1
      AND coverage_total >= coverage_reported
    )
  );
