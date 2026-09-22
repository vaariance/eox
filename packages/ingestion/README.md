# @eox/ingestion (Peter)

Fetches data from sources (APIs, downloads) and hands clean rows
to `@eox/evidence-store` via `recordObservation()`.

Contract: ingestion never writes to the database directly.
It always goes through the evidence-store functions.
