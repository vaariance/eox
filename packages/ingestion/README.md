# @eox/ingestion (Peter)

Fetches data from sources (APIs, downloads) and hands clean rows
to `@eox/evidence-store` via `recordObservation()`.

Contract: ingestion never writes to the database directly.
It always goes through the evidence-store functions.

## Indicator scope

Out of the 25-indicator taxonomy, only indicators with a verified, working
data pipeline across every pilot country are implemented here. Everything
else is skipped until it clears that bar.

Pilot set: 30 countries (see `src/pilot-countries.ts`), assessed per indicator
in `EOX_API_Country_Bindings.csv` (local, not in this repo).

| Indicator | Pilot coverage | Status |
|---|---|---|
| Container Throughput (#6) | 30/30 verified | Implemented |
| Real Estate Valuation (#17) | 30/30 | Implemented |
| Real GDP Vintages (#21) | 30/30 | Implemented |
| Core CPI Inflation (#22) | 30/30 (NZL quarterly) | Implemented |
| Unemployment Rates (#23) | 30/30 (NZL quarterly) | Implemented |
| Central Bank Policy Rates (#24) | 30/30 (euro members via ECB) | Implemented |
| everything else | partial, paid-only, or unverified | Not implemented |

## Revisions and reruns

The evidence store is append-only, so every ingest compares fetched values
against the latest stored value per country and period (`record-revisions.ts`)
and only records new periods or changed values. Reruns are safe and cheap.

## Container Throughput

Source: IMF PortWatch `Daily_Ports_Data` ArcGIS FeatureServer (public, no API key).
Daily port-level container import/export tonnage estimates, aggregated to a
per-country daily total.

```bash
pnpm --filter @eox/ingestion ingest:container-throughput          # latest available date
pnpm --filter @eox/ingestion ingest:container-throughput 2026-09-25  # specific date
```

## Real Estate Valuation (#17)

Source: BIS `WS_SPP` selected residential property prices, quarterly, real
(CPI-deflated) index with 2010 = 100 (`VALUE=R`, `UNIT_MEASURE=628`).
Indicator `residential_property_price_real`. This is the residential price
component only; transaction volumes are not covered. Real values already
correct for inflation, so do not deflate them again downstream.

```bash
pnpm --filter @eox/ingestion ingest:residential-property-price        # from 2021
pnpm --filter @eox/ingestion ingest:residential-property-price 2010   # custom start year
```

## Real GDP Vintages (#21)

Source: OECD `DSD_STES_REVISIONS@DF_STES_REVISIONS` (Main Economic Indicators
monthly archive editions), measure `B1GQ_Q`, quarterly, national currency.
Indicator `gdp_real_volume`, stored in millions of national currency because
JPN, KOR and COL levels exceed the `NUMERIC(20,6)` column in raw units.

Each archive edition becomes a vintage (`oecd-edition-YYYYMM`) with `known_at`
set to the first day of that edition month, so `getAsOf` returns the value as
it was published at the time. Editions are monthly archive snapshots, not exact
national first-release timestamps.

```bash
pnpm --filter @eox/ingestion ingest:gdp-real-volume            # from 2021-Q1
pnpm --filter @eox/ingestion ingest:gdp-real-volume 2015-Q1    # custom start
```

## Core CPI Inflation (#22) and Unemployment Rates (#23)

Source: OECD Data API. Indicators `cpi_core_yoy` (CPI excluding food and energy,
percent year on year) and `unemployment_rate` (age 15+, total, seasonally
adjusted, percent of labour force).

Core CPI queries both the COICOP 2018 and the original-classification monthly
flows and keeps, per country, whichever series is most recent. Countries with
no monthly series (NZL) fall back to their native quarterly series; quarterly
values are never interpolated to monthly.

Neither feed carries release vintages, so each run records changed values with
vintage `retrieved-YYYY-MM-DD` and `known_at` set to the retrieval time.

```bash
pnpm --filter @eox/ingestion ingest:core-cpi                 # from 2021
pnpm --filter @eox/ingestion ingest:unemployment-rate 2018   # custom start year
```

## Central Bank Policy Rates (#24)

Source: BIS `WS_CBPOL`, monthly, end of period. Indicator `policy_rate`.
Euro-area members map to the ECB rate (`XM`), filtered to periods on or after
each country's euro adoption date. Instrument definitions differ by country;
see the BIS `COMPILATION` metadata.

```bash
pnpm --filter @eox/ingestion ingest:policy-rate        # from 2021
pnpm --filter @eox/ingestion ingest:policy-rate 2010   # custom start year
```

## OECD rate limits

The OECD Data API throttles per IP and answers with HTTP 429 or drops
connections once the limit is reached; the block can last around an hour.
Requests are retried with backoff, but avoid running the OECD ingests in tight
loops.

The OECD server returns HTTP 500 for uncached queries sent with
`Accept-Language: *`, which Node's `fetch` adds by default. The SDMX client
therefore always sends `Accept-Language: en`.
