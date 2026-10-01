INSERT INTO indicators (id, name, unit, dimension) VALUES
  ('container_throughput', 'Container port throughput (import + export, estimated tonnage)', 'metric_tonnes', 'B');

INSERT INTO sources (id, name, country_iso3, provenance_class, redistributable, url) VALUES
  ('imf-portwatch', 'IMF PortWatch Daily Ports Data', NULL, 'official_adjacent', false, 'https://portwatch.imf.org');
