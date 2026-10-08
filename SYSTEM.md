# EOX system contract

Version 1 · drafted 2026-10-08 by Joel (Claude Code) at Peter's request ·
**status: proposed, awaiting sign-off.**

This file pins the decisions every package must agree on: time frames, data
types, storage, commitments, and what pre-commitment, challenge and
post-commitment mean. It is derived from Paper 1 (RPM), Paper 3 (EOX), the
oracle design plan, `docs/upstream-readiness.md` and the code at `80ac730`.

Unlike `AGENTS.md`, this file is **versioned, not append-only**: change it only
by bumping the version, getting sign-off from the owners named in the change,
and appending an `AGENTS.md` entry that says what changed.

Every decision carries a status:

| Status | Meaning |
|---|---|
| **PINNED** | True in the code today and consistent with the papers. Changing it breaks another package. |
| **PROPOSED** | Recommended default. Needs the named owner's sign-off before it is relied on. |
| **OPEN** | Undecided. Named owner must decide; no package may assume an answer. |

## 1. Owners

| Area | Owner | Folders |
|---|---|---|
| Data layer: sources, ingestion, evidence store, live evidence adapter, dev operations | Joel | `packages/ingestion`, `packages/evidence-store`, `deploy/`, `postman/` |
| Methodology and continuous oracle | Peter | `packages/methodology`, `packages/oracle`, `apps/oracle-worker` |
| Annual optimistic oracle (UMA, Wormhole, settlement program) | Godwin | `packages/optimistic-oracle` |
| Market contracts and app | unassigned | `apps/` |

Owners as practised since 2026-10-05. The root `README.md` still lists Peter for
ingestion; confirm or correct it there.

## 2. The system in one path

Paper 3 §4 requires that evidence, methodology, market and settlement never
collapse into one authority. The components map onto that pipeline as follows.

```text
sources (OECD, BIS, IMF PortWatch)
  │ ingestion: fetch, store raw bytes, normalise            [Joel]
  ▼
evidence store (Postgres, append-only)                      [Joel]
  │ live evidence adapter = EvidenceProvider port            [Joel, missing]
  ▼
oracle worker → eox-oracle program (Solana)                  [Peter]
  continuous references: country state, WORLD, country/WORLD
  per-evidence challenges inside each proposal window
  │ annual snapshot at the cutoff                            [Peter + Godwin, missing]
  ▼
EoxAssertionAdapter (EVM) → UMA Optimistic Oracle V3         [Godwin]
  │ Wormhole VAA
  ▼
eox_settlement_oracle (Solana): one final result per year    [Godwin]
  ▼
market contracts and app: trade continuously, settle per epoch  [unassigned]
```

Two Solana programs exist and must not be confused. `eox-oracle` (Peter)
publishes continuous references. `eox_settlement_oracle` (Godwin) stores the
one settled result per year.

## 3. Time: three clocks

Paper 3 §10–11 and §22 and Paper 1 §13 describe three different clocks. The
"one year versus minutes" disagreement is these clocks being mixed up. All
three exist and each has exactly one meaning.

### 3.1 Data clock: when evidence arrives — PINNED

| Indicator | Source | Native period | Polled |
|---|---|---|---|
| `container_throughput` | IMF PortWatch | daily | daily |
| `residential_property_price_real` | BIS WS_SPP | quarterly | daily |
| `gdp_real_volume` | OECD MEI archive editions | quarterly (vintaged by monthly edition) | daily |
| `cpi_core_yoy` | OECD | monthly (NZL quarterly) | daily |
| `unemployment_rate` | OECD | monthly (NZL quarterly) | daily |
| `policy_rate` | BIS WS_CBPOL | monthly | daily |

- Ingestion runs once a day at 06:00 UTC (`deploy/dev/setup.sh`). A new row is
  written only when a value or its coverage changes (`record-revisions.ts`).
- Frequencies are never mixed within a series and never interpolated (Paper 3
  §11; `packages/methodology/README.md`).

### 3.2 Reference clock: when EOX references move — PINNED (devnet values)

References move only when accepted evidence changes (Paper 3 §11). Between
releases the market price may move; the reference must not.

| Step | Value | Where |
|---|---|---|
| Worker collects changes into one proposal | 5 s after the first pending change | `apps/oracle-worker/src/worker.ts` |
| Refresh with no new evidence | every 60 s | same |
| Challenge window after pre-commitment | 60 s | `eox-oracle` `lib.rs` |
| Calculate and publish after post-commitment | within 3,600 s, else expired | same |

**PROPOSED (Peter):** 60 s is a devnet value. The production challenge window
must be long enough for a disputer to fetch the artifact and file through the
dispute path in §6, and is set per epoch in the methodology configuration.
Recommended starting point: 2 hours.

### 3.3 Settlement clock: when money settles — PINNED

| Step | Value | Where |
|---|---|---|
| Epoch | one calendar year of economic performance, e.g. epoch 2026 | `EoxAssertionAdapter` |
| Evidence cutoff | 31 July of the following year, 00:00 UTC | `cutoffTimestamp(year)`, both chains |
| Assertion window | cutoff to cutoff + 21 days | adapter |
| UMA liveness (dispute period) | 72 hours per assertion | adapter |
| Void deadline if no result reaches Solana | cutoff + 35 days | `eox_settlement_oracle` |

Epoch 2026 therefore settles on what the official sources said about 2026, as
known on 31 July 2027. Positions trade continuously during the epoch (Paper 3
§22–23); only settlement is annual.

**PROPOSED (Peter, Godwin):** the continuous oracle's `epoch id` equals the
settlement year, and one methodology configuration is sealed per year, so the
continuous references and the annual result for year Y use the same rules.
Methodology changes take effect only at a new epoch (Paper 3 §22).

## 4. The indicators going live — PROPOSED (Peter)

v1 goes live with exactly the six indicators in §3.1 for all 30 pilot
countries. They are the only indicators with a tested, keyless source returning
data for every pilot country, verified live on 2026-10-06 (Postman collection,
30/30 each).

| # | Indicator | Why not in v1 |
|---|---|---|
| 1, 2, 4 | Nighttime lights, NO₂, NDVI | Global satellite catalogues work, but per-country extraction (authenticated downloads, raster processing, boundaries, QA masks) is untested |
| 3 | Power grid load | Ember needs a key to confirm coverage and reports energy (TWh), not load (MW) |
| 5 | Water inundation | Archive ends 2024; no verified current API |
| 7 | Air freight | Historical carried freight only, latest 2023 |
| 13 | Overnight rates | Mixed instruments; 3 countries unresolved |
| 15 | Bankruptcy | 17 of 30 countries |
| 20 | Job openings | 10 of 30 countries |
| 25 | Fiscal deficit | Actual-versus-estimate status unresolved for 14 countries |
| 9, 12, 16, 18, 19 | Fleet intent, bond spreads, PMI, retail search, mobility | Paid or application-only |
| 8, 10, 11, 14 | Heavy vehicles, storage, interbank inflows, parallel FX | No verified source |

Adding an indicator requires 30/30 live verification, an ingestion pipeline, a
catalogue entry in `packages/methodology/src/catalogue.ts`, and a new epoch.

## 5. Data types and storage

### 5.1 Evidence store — PINNED

Postgres 16. `observations` and `source_payloads` are append-only, enforced by
database triggers. Corrections are new rows linked by `supersedes_id`.

| Column | Meaning |
|---|---|
| `id` | local bigserial; never a portable identity |
| `country_iso3`, `indicator_id`, `source_id` | catalogue identifiers, identical to `packages/methodology` |
| `period_start`, `period_end` | calendar dates of the native period |
| `value` | `NUMERIC(20,6)`, normalised; GDP in national-currency millions |
| `raw_value` | the source's value string, byte-exact |
| `raw_sha256` | SHA-256 of the stored HTTP response in `source_payloads` |
| `vintage` | `oecd-edition-YYYYMM` for GDP, `retrieved-YYYY-MM-DD` otherwise |
| `known_at` | source claim of when the value became known; GDP edition month; can be backdated |
| `recorded_at` | stamped by the database on insert; callers cannot set it |
| `published_at` | empty unless the source states a publication time; no current source does |
| `coverage_reported`, `coverage_total` | both or neither; PortWatch ports reporting / ports returned |

### 5.2 Worker evidence record — PINNED shape, PROPOSED mapping (Joel, Peter)

The worker consumes `EvidenceRecord` (`apps/oracle-worker/src/types.ts`) through
the `EvidenceProvider` port. The live adapter maps each observation as follows.

| Field | Mapping | Status |
|---|---|---|
| `recordId` | `eox:observation:<id>`; unique per immutable row | PROPOSED |
| `seriesId` | `seriesIdentity(country, indicator)` from `@eox/methodology` | PINNED |
| `revisionId` | the row's `vintage` | PROPOSED |
| `country` | ISO2 as configured on chain | PINNED |
| `indicator`, `source`, `unit` | catalogue strings | PINNED |
| `period` | `periodOrdinal(frequency, native period)` as an integer string | PINNED |
| `value` | exact decimal per §5.3 | PROPOSED |
| `publishedAt` | per §5.4 | OPEN |
| `knownAt` | `known_at` in Unix seconds, or null | PROPOSED |
| `recordedAt` | `recorded_at` in Unix seconds | PROPOSED |
| `artifactDigest` | `raw_sha256` | PINNED |
| `manifest` | confidence assertion manifest from `compileConfidence` | PINNED shape |
| `confidenceBps` | eight factors in the oracle's fixed order | OPEN (Peter: rubric) |
| `supersedes` | `eox:observation:<supersedes_id>` for corrections | PROPOSED |
| `comparisonRecordId` | the record the rule's comparison period selects | PROPOSED |

All times in the worker and on chain are Unix **seconds**. All fixed-point
values use scale 1,000,000, nearest rounding with ties away from zero.

### 5.3 Precision — PROPOSED (Peter)

The oracle rejects values with more than six significant fractional digits
(`exactValue`). The evidence store keeps the exact source string in
`raw_value`.

- BIS series, unemployment and GDP (after the declared ×10⁻⁶ unit conversion)
  fit within six digits.
- OECD core CPI sends up to nine fractional digits.
- Container throughput has no single raw value: it is a sum over ports,
  currently formatted with `toFixed(6)`, which is itself an unnamed rounding.

Recommended rule: the methodology declares, per series, "round half away from
zero to 6 places" as a named, versioned conversion, applied by the adapter to
`raw_value` (and, for container throughput, to an exact decimal sum of the
port values in the stored payload) and recorded in the manifest. Silent
rounding is forbidden.

### 5.4 Publication time — OPEN (Peter decides, Joel implements)

The oracle requires `publishedAt` for freshness. None of the six sources
returns a publication time, and `recorded_at` must not be copied into it.

Recommended policy `PUBLICATION/OBSERVED-BY/V1`, stored in its own column:
`publishedAt` is the earliest `recorded_at` of the first observation carrying
that value and vintage, labelled as an upper bound ("published no later
than"). Its error is at most one polling interval (24 h). The manifest names the
policy so a later release-calendar policy can replace it in a new epoch without
rewriting history.

### 5.5 Change feed — PROPOSED (Joel)

`readChanges(cursor)` must never skip a row that commits late. A plain
`id > cursor` scan can skip rows from a transaction that started earlier but
committed later.

Design: record the inserting transaction ID (`xid8`) on each observation. A
page returns rows ordered by `(xid, id)` whose transaction ID is below the
oldest transaction still running (`pg_snapshot_xmin`). The cursor is the last
`(xid, id)` returned. Change IDs are `eox:change:<id>`. Corrections appear as
new changes; history is never rewritten, so a cursor stays valid forever.

### 5.6 Artifact retrieval — PROPOSED (Joel)

`retrieveArtifact(digest)` returns `source_payloads.body` for that SHA-256. The
database already rejects a body whose hash does not match. For challengers, the
same bytes are served read-only over HTTP at `/artifacts/<sha256>`.

### 5.7 Durability — PINNED / OPEN

- Evidence: Postgres on the dev VM, append-only. **OPEN (Joel):** no backups
  yet; add daily `pg_dump` to a GCS bucket with retention before testnet use.
- Worker: filesystem journal plus a PID lock; one writer only.
- Chain: the authoritative record of proposals, challenges and publications.

## 6. Commitments and challenges

### 6.1 Identities — PINNED; never substitute one for another

| Identity | Definition | Defined in |
|---|---|---|
| Artifact digest | SHA-256 of the raw HTTP response | evidence store, oracle math |
| Evidence digest | `EOX/ORACLE/V1` domain `evidence` over stable fields | `packages/oracle/crates/math` |
| Metadata digest | domain `evidence-metadata` | same |
| Methodology manifest digest | SHA-256 of the `EOX/METHODOLOGY/V1` manifest | `packages/methodology` |
| Configuration digest | sealed rules for an on-chain epoch | `eox-oracle` |
| Annual claim | evidence root, methodology image ID, output hash, resolution URI hash | `EoxAssertionAdapter` |

### 6.2 What the three words mean

Both oracle layers follow the same three steps from the oracle design plan,
at different scopes.

| Step | Continuous oracle (per proposal) | Annual oracle (per year) |
|---|---|---|
| **Pre-commitment** | Freeze the evidence pages and set the challenge deadline; binds evidence digest, deadline and adapter | `assertResult`: post the claim and bond to UMA |
| **Challenge** | Dispute one exact evidence record inside the window; registered through the configured adapter key | Dispute the assertion on UMA within 72 h; UMA's vote decides |
| **Post-commitment** | Original commitment + evidence digest + ordered challenge-event digest + global challenge history + evaluation time; only after every challenge resolves and closure is attested | The settled claim, relayed over Wormhole and stored once per epoch |

Data is never modified at any step. A successful challenge rejects the
proposal; the corrected evidence enters as a new record in a later proposal.

### 6.3 Who authenticates continuous challenges — OPEN (Peter, Godwin)

Today `eox-oracle` trusts one configured adapter key that simulates UMA. Peter
asked not to build the optimistic challenge pipeline from scratch, and the
annual path already uses UMA through `EoxAssertionAdapter`. Recommended: carry
per-record challenges through UMA too, as assertions about a single evidence
digest, relayed over the same Wormhole route, with the program verifying the
VAA instead of a test key. Until decided, the continuous oracle is devnet-only.

### 6.4 From continuous references to the annual claim — OPEN (Peter, Godwin)

The annual claim covers "the official observations for year Y known at the
cutoff", but the continuous oracle publishes the latest observation per slot.
These select different records. Recommended:

1. The methodology defines an annual selection rule: for each series, the
   latest vintage known at the cutoff of every period inside year Y.
2. The evidence root is the Merkle root, in the engine's canonical encoding,
   of exactly those evidence digests.
3. `methodologyImageId` is the configuration digest of epoch Y on `eox-oracle`;
   `outputHash` hashes the final country and WORLD states computed from that
   selection.
4. The snapshot and its artifacts are published at the resolution URI before
   assertion, so a UMA voter can re-run it.

## 7. Operations — PINNED / PROPOSED

| Component | Runs today | Proposed (owner) |
|---|---|---|
| Postgres + six ingests | dev VM `eox-dev`, GCP `colosseum-eox` | unchanged (Joel) |
| Evidence adapter and artifact server | — | same VM, systemd service (Joel) |
| Oracle worker | local fixture only | same VM, systemd service, journal on persistent disk (Peter, Joel) |
| Annual adapter | Sepolia, deployed 2026-10-08 | relay bot for `publishResult` and the VAA post (Godwin) |
| Continuous program | devnet tests | deploy to Solana devnet (Peter) |
| App backend | — | after §5 and §6 are closed |

Testnets: EVM Sepolia and Solana devnet. The adapter README targets Base for
mainnet.

## 8. Rules for every agent

1. Read this file and `AGENTS.md` before working.
2. Never invent a publication time, a value or a precision. Use `raw_value` and
   a named conversion.
3. Never mix the three clocks in §3. Name which one a timing belongs to.
4. Never substitute one identity in §6.1 for another.
5. Never rewrite evidence. Corrections are new records.
6. Fetch and rebase before pushing; `main` is shared.
7. A PROPOSED or OPEN item is not a decision. Do not build on it as if it were.

## 9. Sign-off

| Section | Needs | Signed |
|---|---|---|
| §3.2 production challenge window | Peter | |
| §3.3 epoch id = settlement year | Peter, Godwin | |
| §4 six live indicators | Peter | |
| §5.2–5.6 adapter mapping, change feed, artifacts | Peter, Joel | |
| §5.3 precision rule | Peter | |
| §5.4 publication-time policy | Peter | |
| §6.3 continuous challenge authentication | Peter, Godwin | |
| §6.4 annual claim mapping | Peter, Godwin | |
