# evidence-api (Joel)

Read-only HTTP service that exposes the evidence store as oracle evidence. It is
the data layer's side of the worker's `EvidenceProvider` port
(`apps/oracle-worker/src/types.ts`): the worker reads evidence over HTTP and never
touches the database. Contract: `SYSTEM.md` §5.

```bash
pnpm --filter @eox/evidence-api start   # http://127.0.0.1:8787, DATABASE_URL from the environment
pnpm --filter @eox/evidence-api test
```

## Endpoints

| Request | Returns |
|---|---|
| `GET /v1/changes?cursor=&limit=` | `{ cursor, changes: [{ changeId, recordId }] }`, oldest first, at most `limit` (1–500, default 128) rows scanned per page |
| `GET /v1/records/:recordId` | one evidence fact, below |
| `GET /v1/artifacts/:sha256` | the exact raw source response; `x-content-sha256` and `x-source-content-type` headers |
| `GET /health` | `{ status: "ok" }` |

Every other method or path is refused. Inputs are validated against strict
patterns before reaching the database.

## Change feed

Start with no cursor and pass back the returned `cursor` each time. A cursor stays
valid forever because history is never rewritten. When nothing is new the same
cursor comes back with no changes.

Pages only include rows whose inserting transaction is older than every
transaction still running, so a row that commits late is never skipped
(migration `007_change_feed.sql`). A page can return fewer changes than `limit`,
or none, while the cursor still advances past rows that are not oracle evidence.

## Evidence facts

A fact is served only for an observation that is oracle evidence: a catalogue
series from `@eox/methodology` (30 pilot countries × six indicators), from the
catalogue's source, with a stored raw payload and a period matching the series
frequency. Everything else returns 404 and is left out of the change feed.

| Field | Meaning |
|---|---|
| `recordId` | `eox:observation:<id>`; one immutable row |
| `seriesId` | `seriesIdentity(country, indicator)` |
| `revisionId` | the row's vintage |
| `country`, `countryIso3` | ISO2 as configured on chain, and ISO3 |
| `indicator`, `source`, `unit`, `frequency` | catalogue values |
| `period`, `periodOrdinal` | native label (`YYYY-MM-DD`, `YYYY-MM`, `YYYY-Qn`) and `periodOrdinal` |
| `value`, `rawValue` | stored normalised value and the source's exact string |
| `publishedAt` | Unix seconds, or `null`: no current source states one (`SYSTEM.md` §5.4) |
| `knownAt`, `recordedAt` | Unix seconds |
| `artifactDigest` | SHA-256 of the raw response, retrievable from `/v1/artifacts` |
| `coverage` | `{ reported, total }` for container throughput, else `null` |
| `supersedes` | the corrected record's `recordId`, or `null` |

Facts deliberately leave out `confidenceBps`, `manifest` and `comparisonRecordId`.
Those are methodology assertions and selections (Peter), assembled on the worker
side. Until the publication-time policy is agreed, the worker's readiness check
rejects these facts, which is the intended behaviour.
