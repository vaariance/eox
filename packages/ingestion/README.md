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
| Container Throughput | 30/30 verified | Implemented |
| everything else | partial, paid-only, or unverified | Not implemented |

## Container Throughput

Source: IMF PortWatch `Daily_Ports_Data` ArcGIS FeatureServer (public, no API key).
Daily port-level container import/export tonnage estimates, aggregated to a
per-country daily total.

```bash
pnpm --filter @eox/ingestion ingest:container-throughput          # latest available date
pnpm --filter @eox/ingestion ingest:container-throughput 2026-09-25  # specific date
```
