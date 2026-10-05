INSERT INTO indicators (id, name, unit, dimension) VALUES
  ('gdp_real_volume', 'Real GDP, volume (archived monthly editions)', 'national_currency_millions', 'E');

INSERT INTO sources (id, name, country_iso3, provenance_class, redistributable, url) VALUES
  ('oecd', 'OECD Data Explorer (SDMX)',                           NULL, 'official', true, 'https://data-explorer.oecd.org'),
  ('bis',  'Bank for International Settlements Data Portal (SDMX)', NULL, 'official', true, 'https://data.bis.org');
