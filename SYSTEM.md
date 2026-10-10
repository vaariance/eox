# COX system contract

Version 2 · 10 October 2026 · **status: proposed, awaiting sign-off.**

Version 2 replaces the EOX contract (version 1, drafted 2026-10-08 by Joel) with
the contract for COX, the Crypto Outlook Index. The product source is
`docs/cox/cox-paper-3.md` (COX Paper 3, v0.1). The work assignments, and what
each person preserves, carries over or deletes, are in `product.md`. Version 1
is in git history; nothing in it binds COX work unless this file repeats it.

This file pins the decisions every package must agree on: clocks, data types,
storage, identities, the publication cycle, the reference and pool arithmetic
boundaries, failure behaviour and operations.

It is **versioned, not append-only**: change it only by bumping the version,
getting sign-off from the owners named in the change, and appending an
`AGENTS.md` entry that says what changed.

| Status | Meaning |
|---|---|
| **PINNED** | A COX Paper 3 product commitment, or infrastructure that exists today and is carried into COX unchanged. Changing it breaks another package or the product. |
| **PROPOSED** | MVP choice made in this version. Needs the named owner's sign-off before it is relied on outside devnet. |
| **OPEN** | Undecided. The named owner decides; no package may assume an answer. |

## 1. Owners

| Area | Owner | Folders (target layout) |
|---|---|---|
| Price evidence: Hermes archiver, evidence store, evidence API, dev operations, signing service, app API and client | Joel | `packages/ingestion`, `packages/evidence-store`, `apps/evidence-api`, `apps/signer`, `packages/signing`, `apps/app-api`, `packages/app-api`, `deploy/` |
| Methodology, mechanism specification, COX math, the `cox` Solana program, publisher | Peter | `packages/cox-methodology`, `packages/cox` (Rust workspace: `crates/math`, `crates/cli`, `programs/cox`), `apps/cox-publisher` |
| Independent monitor and trading UI | Godwin | `apps/cox-monitor`, `apps/web` |

The EOX folders that `product.md` marks for deletion (`packages/oracle`,
`packages/methodology`, `packages/optimistic-oracle`, `apps/oracle-worker`,
`apps/uma-relay`) are not part of COX. Do not add COX code to them.

## 2. The system in one path

COX Paper 3 §14 separates the external price world from two deterministic
engines (reference and collateral) and a ledger. Each boundary must be
independently reproducible.

```text
Pyth price service (Hermes)                                   external
  │ archiver: fetch the signed update for each minute cutoff,
  │ store raw bytes, decode, check admissibility             [Joel]
  ▼
evidence store (Postgres, append-only) → evidence API          [Joel]
  │ publisher reads the archived update for the cutoff        [Peter]
  ▼
Pyth Solana Receiver: guardian-verified PriceUpdateV2 accounts  external
  ▼
cox program (Solana)                                           [Peter]
  1 close batch k at its cutoff
  2 validate the price snapshot against the manifest
  3 reference engine: CRYPTO level, asset references
  4 collateral engine: revalue existing claim classes
  5 execute batch k requests at the post-revaluation unit values
  6 commit publication k (predecessor-linked, atomic to users)
  │
  ├──► cox-monitor: recompute every publication independently  [Godwin]
  └──► app API: indexer, quotes, unsigned transactions          [Joel]
          ▼
       web app: wallet-signed requests, portfolio, status      [Godwin]
```

There is no UMA assertion, no challenge window, no EVM chain and no Wormhole
relay of our own in this path (Paper 3 §2, §6, §16). Authentication comes from
Pyth's guardian-verified updates; correctness comes from deterministic on-chain
checks plus independent recomputation.

## 3. Time

COX has four clocks. Name which one a timing belongs to; never mix them.

### 3.1 Source clock — PINNED

Pyth publishes signed price updates continuously (sub-second). Each update
carries its own `publish_time` (Unix seconds). COX never treats archive time,
posting time or slot time as a price's observation time.

### 3.2 Batch clock — PINNED cadence, PROPOSED offsets (Peter)

| Item | Value |
|---|---|
| Cadence | one minute (Paper 3 §7) |
| Cutoff of batch `k` | `cutoff_k = origin + 60·k`, UTC minute boundary |
| Request admission | a request belongs to the first batch whose cutoff is strictly after the on-chain `Clock::unix_timestamp` of its submission |
| Cancellation | allowed only while its batch is open (before the cutoff); never after |
| Observation window | each feed's accepted update has `cutoff_k ≤ publish_time ≤ cutoff_k + 5 s` |
| Synchronisation | max − min `publish_time` across the snapshot ≤ 3 s |

Requests bind before their execution prices exist; prices are observed only
after the cutoff (Paper 3 §7–8). The selection rule inside the window is §6.3.

### 3.3 Publication clock — PROPOSED (Peter)

| Item | Value |
|---|---|
| Publication `k` | revaluation and execution for batch `k`, committed in program state |
| Commit deadline | `cutoff_k + 45 s`; after it, batch `k` cannot publish and its requests roll to batch `k+1` unless expired |
| Missed batch | no publication; the next valid publication spans the elapsed interval (Paper 3 §3) |
| Delayed status | no publication for 3 consecutive cutoffs |
| Halted status | no publication for 60 consecutive cutoffs (§9) |

### 3.4 Methodology clock — PINNED

Methodology versions activate prospectively at a declared future batch
sequence. There is no epoch expiry, annual cutoff or terminal maturity for
positions (Paper 3 §13, §15). The EOX settlement clock (31 July cutoff, 72 h
liveness, 35-day void) does not exist in COX.

## 4. Universe and benchmark

### 4.1 MVP roster — PROPOSED (Peter, data check by Joel)

| Asset id | Pyth feed | Status |
|---|---|---|
| `BTC` | `Crypto.BTC/USD` | MVP |
| `ETH` | `Crypto.ETH/USD` | MVP |
| `SOL` | `Crypto.SOL/USD` | MVP |
| `ZEC` | `Crypto.ZEC/USD` (`be9b59d1…25bb24`) | included only if Joel's feed check (§10) passes before the manifest is sealed |
| `STARK` | — | excluded until its asset identity is resolved (Paper 3 §1) |

An asset is identified by its asset id **and** its 32-byte Pyth feed id; a
ticker alone is never an identity. Quote currency is USD. The benchmark roster
equals the tradable roster (Paper 3 §4 boundary case); the pilot benchmark is
labelled `CRYPTO (pilot, N assets)` everywhere it is shown.

### 4.2 CRYPTO — PROPOSED (Peter)

Equal weights `w = 1/N`, re-applied at every publication (constant equal
weights). Chain-linked:

```text
B_k = B_{k-1} · Σ_i w · (P_i,k / P_i,k-1)          B_origin = 100
```

A missed publication is a **rebalance freeze**: the next publication links one
step over the elapsed interval with the weights in force at the last
publication. This is the predefined outage policy Paper 3 §4 requires; no
intermediate prices are reconstructed or invented.

### 4.3 COX reference — PINNED (Paper 3 §3)

```text
A_i,k = P_i,k / P_i,origin      W_k = B_k / B_origin      Q_i,k = 100 · A_i,k / W_k
```

Sensitivity is 1x. 100 is a display base. Ratio-relative change, never
percentage-point subtraction. Prices are price return only: no staking, yield or
airdrops.

## 5. Data types and storage

### 5.1 Evidence store — PINNED machinery, PROPOSED COX schema (Joel)

Carried over unchanged from EOX: Postgres 16; `source_payloads` holds every
response byte-for-byte with a database-checked SHA-256; append-only triggers;
`recorded_at` stamped by the database; transaction-ID change feed (migration
`007`); daily verified backups to `gs://colosseum-eox-db-backups`.

New COX tables (new migrations; EOX tables stay as a read-only archive with no
writers):

| Table | Key columns |
|---|---|
| `assets` | `asset_id`, `feed_id` (32-byte hex), `symbol`, `quote` |
| `price_updates` | one row per archived Hermes response: `cutoff`, `raw_sha256` → `source_payloads`, `feed_ids`, `recorded_at` |
| `price_observations` | `asset_id`, `feed_id`, `cutoff`, `price` (i64 as text), `conf` (u64 as text), `expo`, `publish_time`, `prev_publish_time`, `raw_sha256`, `recorded_at`, `admissible`, `rejection` |
| `incidents` | `cutoff`, `kind`, `detail`, `raw_sha256` (nullable), `recorded_at` |

Rules: integers exactly as the source states them; no decimal conversion is
stored as if it were the source value; a rejected observation is recorded with
its reason, never replaced by a substitute (Paper 3 §6).

### 5.2 Prices on chain — PROPOSED (Peter)

The program reads Pyth `PriceUpdateV2` accounts owned by the Pyth Solana
Receiver program, requires `VerificationLevel::Full`, and checks the feed id
against the manifest. Prices are used as raw integers with the manifest-pinned
exponent; a feed whose exponent differs from the manifest is inadmissible.
Ratios are computed from the raw integers, so no price is rescaled.

### 5.3 Arithmetic — PROPOSED (Peter)

- Reference arithmetic: checked integer arithmetic in `i128`, reference values
  stored at scale 10¹², nearest rounding with ties away from zero (carried over
  from `eox-oracle-math`).
- Claim arithmetic: collateral amounts in the collateral token's base units
  (`u64`); units in `u128` at scale 10¹². Mint and redemption round **down**
  for the user; every residual goes to a named `residual` ledger line owned by
  the pool, never redistributed and never taken by the operator.
- One Rust crate (`packages/cox/crates/math`) defines both. The program, the
  CLI and the published vectors use it. The monitor reimplements it
  independently in TypeScript and must match the vectors byte for byte.

### 5.4 Durability — PINNED / PROPOSED

- Evidence: Postgres on the dev VM, append-only, daily backups (PINNED).
- Chain: the authoritative record of publications, requests, positions and the
  ledger (PINNED).
- Publisher: filesystem journal plus PID lock, one writer (carried over from
  the oracle worker; PROPOSED for COX).

## 6. Identities and the publication

### 6.1 Identities — never substitute one for another

| Identity | Definition | Status |
|---|---|---|
| Asset identity | `(asset_id, feed_id)` | PROPOSED |
| Artifact digest | SHA-256 of the raw Hermes response | PINNED |
| Price message digest | SHA-256 over domain `COX/PRICE/V1` of `(feed_id, price, conf, expo, publish_time)` | PROPOSED |
| Snapshot digest | SHA-256 over domain `COX/SNAPSHOT/V1` of the ordered price message digests and the cutoff | PROPOSED |
| Methodology manifest digest | SHA-256 of the canonical `COX/METHODOLOGY/V1` manifest | PROPOSED |
| Publication identity | `(program, pool, sequence)`; links its predecessor's sequence and state digest | PROPOSED |
| Request identity | request account address; carries owner, batch, operation, amounts, conditions | PROPOSED |

### 6.2 What a publication binds — PROPOSED (Peter)

Sequence, batch cutoff, predecessor, methodology manifest digest, snapshot
digest, each asset's price and `publish_time`, CRYPTO level, each COX
reference, each class's pre-flow and post-flow backing and units, executed and
rejected request counts, and the resulting ledger totals. A publication cannot
be replayed as a new interval; sequence and predecessor enforce it.

### 6.3 Snapshot selection — PROPOSED (Peter, Joel)

The accepted update for each feed is the **first** Hermes update with
`publish_time ≥ cutoff_k`. The archiver fetches it by timestamp and archives it
before the publisher may use it; the publisher posts exactly the archived bytes.
The program can check only the window and synchronisation bounds in §3.2, not
"first". The monitor checks "first" against Hermes independently and raises an
incident on mismatch. The residual favourable-selection risk inside the
window is accepted for the devnet MVP and must be stated in the app (Paper 3 §6,
§8).

## 7. Collateral engine

### 7.1 Claim classes — PROPOSED (Peter)

One class per listed asset plus one `CRYPTO` class. Unallocated collateral does
not exist inside the pool: a deposit is pending (owned by its depositor) until
it executes into a class.

### 7.2 Transfer rule `COX/TRANSFER/MVP-0` — PROPOSED (Peter), test assets only

```text
h_i = (P_i,k / P_i,k-1) / (B_k / B_k-1)        h_CRYPTO = 1
V_i' = C · V_i · h_i / Σ_j V_j · h_j
```

This is the illustrative rule of Paper 3 §10, with a CRYPTO class providing the
benchmark-growth comparison side. Known property: the benchmark factor cancels,
so asset classes compete on asset returns and CRYPTO-class holders on the
benchmark return. **It is not the production mechanism.** Paper 3 leaves the
transfer rule open; MVP-0 exists so the devnet product can run end to end on a
test token. Real collateral is blocked until a rule is selected under §11.

### 7.3 Units and flows — PINNED identities (Paper 3 §11), PROPOSED edge rules (Peter)

```text
p_i = V_i / U_i         minted = floor(d / p_i)        proceeds = floor(x · p_i)
```

Order inside a publication: revalue existing classes → fix every `p_i` → execute
all batch requests at those fixed `p_i` → commit. Request processing order
cannot change any outcome. A switch is a redemption and a deposit at the same
fixed `p`. Edge rules: an empty class bootstraps at `p = 1` (scaled); a class
with units and zero value accepts no deposits; zero or negative prices make the
snapshot inadmissible (§9); fees are zero in the MVP.

### 7.4 Custody categories — PINNED (Paper 3 §9, §11)

The vault balance must always equal the sum of: active backing `C`, pending
deposits, withdrawal payables and the residual line. No category funds another.
The program asserts this equality at the end of every instruction that moves
value.

## 8. Requests

PROPOSED (Peter):

| Operation | Reserved at submission | Condition fixed in advance |
|---|---|---|
| `deposit(class, amount)` | tokens move into the vault as a pending deposit | `min_units`, `expiry_batch` |
| `switch(from, to, units)` | source units locked; stay exposed until revaluation | `min_units_out`, `expiry_batch` |
| `redeem(class, units)` | units locked; stay exposed until revaluation | `min_proceeds`, `expiry_batch` |
| `withdraw()` | — | pays the caller's withdrawal payable |

A request whose condition fails is rejected at execution with its reservation
returned (deposit back to pending refund, units unlocked). An expired request is
rejected the same way. A new request from the same owner for the same source
units is rejected while one is pending.

## 9. Failure, incidents and governance

PROPOSED (Peter):

- **Inadmissible snapshot** (missing feed, outside window, unsynchronised,
  partial verification, exponent change, price ≤ 0, `conf/price` above the
  manifest bound): no publication for that batch; Joel records an incident;
  requests roll forward until expiry. The last accepted reference stays readable
  with its age and is never executed against (Paper 3 §15).
- **Delayed** (3 missed cutoffs): the app shows delayed; nothing changes on chain.
- **Halted** (60 missed cutoffs): the program accepts only cancellation of
  pending requests and refund of pending deposits. Positions stay frozen; no
  redemption at a stale value. Resumption is the next valid publication over the
  elapsed interval.
- **Monitor mismatch:** the monitor reports; a human with the admin authority
  pauses. The monitor holds no key.
- **Admin authority:** pause, activate a future methodology version, rotate the
  runtime publisher key. It cannot set prices, references, class values or
  balances, and cannot rewrite a committed publication or withdrawal.

## 10. Operations

| Component | Runs | Owner |
|---|---|---|
| Postgres, backups | dev VM `eox-dev`, GCP `colosseum-eox` (PINNED) | Joel |
| Hermes archiver | same VM, systemd, continuous per-minute loop (PROPOSED) | Joel |
| Evidence API | same VM, `127.0.0.1:8787` (PINNED host, new COX routes) | Joel |
| Signing service | Cloud Run `eox-signer`, KMS `eox-signing-dev` (PINNED) | Joel |
| `cox` program | Solana devnet (PROPOSED) | Peter |
| Publisher | same VM, systemd, journal on persistent disk (PROPOSED) | Peter |
| Monitor | same VM, systemd (PROPOSED) | Godwin |
| App API | same VM; fixture and live origins (PINNED pattern) | Joel |
| Web app | static hosting (OPEN, Godwin) | Godwin |

Testnet: Solana devnet only. Collateral: a devnet SPL test token minted by the
deployment; real USDC is out of scope (§11).

Known external blocker (2026-10-10): Hermes `GET /v2/updates/price/latest` and
`/v2/updates/price/{publish_time}` return `unauthorized` without an API key;
only feed metadata is public. Joel obtains a Hermes key or an alternative
authenticated endpoint before the archiver runs live.

## 11. Rules for every agent

1. Read this file, `product.md`, `AGENTS.md` and COX Paper 3 before working.
2. Never invent a price, timestamp or substitute observation. Rejected inputs
   are recorded incidents.
3. Never execute a request at a valuation that existed before its batch's
   cutoff, and never let processing order change an outcome.
4. Never mix the clocks in §3 or substitute one identity in §6.1 for another.
5. Never let confidence, quality or price uncertainty scale a return; quality
   only admits or rejects (Paper 3 §6).
6. Never present MVP-0 as the production mechanism, a reference as a payout,
   or the pilot CRYPTO as the whole crypto market.
7. Never rewrite evidence or committed publications. Corrections are new
   records.
8. Fetch and rebase before pushing; `main` is shared.
9. A PROPOSED or OPEN item is not a decision outside devnet.

## 12. Open before real collateral

| Item | Owner |
|---|---|
| Production transfer rule replacing MVP-0, with the Paper 3 §17 simulations | Peter |
| Benchmark weight schedule, eligibility and concentration policy | Peter |
| Fees, residual ownership and operational reserves | Peter |
| Snapshot selection without the residual window risk | Peter, Joel |
| Collateral asset, custody and legal structure | Peter |
| Source licensing and archival rights for Hermes data | Joel |

## 13. Sign-off

| Section | Needs | Signed |
|---|---|---|
| §3.2–3.3 batch and publication timing | Peter | |
| §4.1 MVP roster | Peter, Joel | |
| §4.2 CRYPTO construction | Peter | |
| §5.1 COX evidence schema | Joel | |
| §5.2–5.3 on-chain prices and arithmetic | Peter, Godwin (monitor) | |
| §6.3 snapshot selection | Peter, Joel, Godwin | |
| §7 transfer rule MVP-0 and units | Peter | |
| §8 requests | Peter, Joel (builders), Godwin (UI) | |
| §9 failure and governance | Peter | |
