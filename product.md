# COX product direction and work plan

Version 9 · 10 October 2026 · Pivot from EOX to COX

This brief replaces the EOX product direction (version 8, in git history). It
records the decision to stop building EOX and build COX, the Crypto Outlook
Index, described in `docs/cox/cox-paper-3.md` (COX Paper 3). It assigns every
existing piece of work to one developer as **preserve**, **carry over** or
**delete**, and lists the new work needed to reach the COX MVP.

`SYSTEM.md` version 2 is the engineering contract for COX. Where this brief and
`SYSTEM.md` disagree, `SYSTEM.md` wins after sign-off; until then, raise the
conflict rather than choosing. These are requirements, not claims of deployed
behaviour.

## 1. Why the pivot

EOX hit walls that COX removes by design (COX Paper 3 §16):

| EOX wall | COX answer |
|---|---|
| Economic statistics have no machine-readable release times; all 180 slots were blocked or needed a first-observed policy | Prices arrive signed, with their own `publish_time` |
| Methodology needed calibrated anchors, weights and eight-factor confidence ratings that do not exist | Price return needs no normalisation; quality only admits or rejects |
| Every evidence record needed a bonded UMA assertion, relayed over Wormhole, with one-hour windows | No optimistic challenge path; Pyth's guardian-verified updates plus deterministic checks and an independent monitor |
| Two chains, two adapters, a relay, a receiver and six signing roles before one reference could publish | One Solana program, one runtime signing role |
| Quarterly data cannot support continuous trading signals | One-minute publications |
| The exchange payoff and reserve equations were never written | The closed pool and unit accounting are the core of the design, specified first |

What COX keeps from EOX: a shared benchmark, reproducible references,
immutable evidence, separation of evidence, reference and claims, and the
closed-collateral ambition.

## 2. What COX is

A user believes an asset will outperform the crypto market from now on. They
allocate test collateral to that asset's claim class. Every minute, COX takes
signed prices, computes CRYPTO (the shared benchmark) and each asset's COX
reference, revalues the existing claims inside a closed pool, then executes the
requests queued for that minute at the new values. Winners are paid only by
other claims; nothing is created.

Three things stay visible and separate (Paper 3 §13):

- **Underlying price** of the asset.
- **COX reference**: price performance against CRYPTO, starting at 100.
- **Claim value**: what the user's units can redeem for in collateral.

A rising reference is not a promise of the same percentage gain on a position.

## 3. MVP definition

The MVP is complete when a user on Solana devnet can, through the web app and
their own wallet: deposit test collateral into a BTC, ETH, SOL (and ZEC if
admitted) or CRYPTO class; see the request queued for a named batch; see it
execute at the next valid publication; switch classes; redeem; withdraw; and
see every step reconciled by the independent monitor and traceable to archived
price evidence.

| In the MVP | Not in the MVP |
|---|---|
| Solana devnet, test SPL collateral token | Real USDC or any real-value collateral |
| Pyth prices for BTC, ETH, SOL (+ZEC if admitted) | STARK, any asset without a validated feed |
| Equal-weight pilot CRYPTO, one-minute publications | Production weight schedule |
| Transfer rule `COX/TRANSFER/MVP-0`, zero fees | A final transfer rule, fees, reserves |
| Deposit, switch, redeem, withdraw, cancel before cutoff | Secondary market, expectation price, leverage |
| Independent monitor, evidence archive, incidents | UMA, EVM, Wormhole relay of our own, annual settlement |

Every rule behind these choices is in `SYSTEM.md` §3–9. MVP-0 is labelled as a
test mechanism in the app, the API and every document (`SYSTEM.md` §7.2).

## 4. How one minute works

```text
:00   batch k closes (requests after this go to k+1)
:00–:05  Joel's archiver fetches the first Pyth update ≥ cutoff for every feed,
      stores raw bytes, checks admissibility, records incidents
:05–:45  Peter's publisher posts exactly those bytes to the Pyth receiver, then
      the cox program validates → computes CRYPTO and references → revalues
      classes → executes batch k at fixed unit values → commits publication k
after  Godwin's monitor recomputes publication k independently;
      Joel's app API indexes it; the web app shows fills and new values
```

If the snapshot is inadmissible or the publication misses its deadline, batch
k does not publish, its requests roll forward until they expire, and the next
valid publication covers the whole elapsed interval.

## 5. Ownership

| Person | Owns in COX |
|---|---|
| **Joel** | Price evidence (archiver, store, evidence API), dev operations, signing service, app API and typed client, unsigned transaction builders, indexer |
| **Peter** | Methodology manifest, mechanism specification, COX math crate, `cox` Solana program, publisher service, end-to-end verification |
| **Godwin** | Removal of the EVM/UMA stack, independent monitor, web app |

Each task below has exactly one owner. No task is assigned to a pair.

## 6. Preserve, carry over, delete

Definitions used in this section:

- **Preserve** — keep running and unchanged. Do not refactor it for COX.
- **Carry over** — reuse the code or pattern in a COX component, changing what
  the right-hand column says.
- **Delete** — remove from `main` and stop any running service. Before any
  deletion, Peter tags the current `main` as `eox-archive` and pushes the tag
  (step 0), so nothing is lost. Deletions are separate commits
  (`chore(cox): remove ...`).

### 6.1 Joel

| Existing work | Action | What to do |
|---|---|---|
| Dev VM `eox-dev`, Postgres, private RPC, firewall | **Preserve** | Unchanged host for every COX service. |
| Daily backups to `gs://colosseum-eox-db-backups`, `eox-dev-vm` service account | **Preserve** | Unchanged; the backup now also covers COX tables. |
| `packages/evidence-store`: `source_payloads`, SHA-256 check, append-only triggers, `recorded_at`, xid change feed (`007`), migration runner | **Carry over** | Keep the machinery. Add migrations for `assets`, `price_updates`, `price_observations`, `incidents` (`SYSTEM.md` §5.1). Add store functions for them and a change feed over `price_observations`. |
| `packages/evidence-store`: `observations`, `indicators`, `source_releases`, revision links (`001`–`006`, `008`, `009`) and their TS functions | **Delete** (code) / **Preserve** (data) | Applied migrations and their rows stay in the database as a read-only EOX archive. Remove the TS write and query paths for them (`recordObservation`, `recordCorrection`, `getAsOf`, release functions) once nothing imports them. |
| `packages/ingestion`: `sources/payload.ts`, `record-payloads.ts`, `decimal.ts` | **Carry over** | Reuse the raw-byte fetch-and-store path and exact decimals for the Hermes archiver. |
| `packages/ingestion`: OECD, BIS, PortWatch, SDMX sources, all six `indicators/` and `ingest/` modules, `pilot-countries.ts`, `ingest-oecd-snapshot.ts`, `record-revisions.ts`, `port-publication.ts` | **Delete** | Economic indicators are not part of COX. |
| `postman/eox-source-apis.postman_collection.json` | **Delete** | Replace with a Hermes collection (feed metadata, timestamped update). |
| `deploy/dev/run-ingests.sh` and its hourly cron line in `setup.sh` | **Delete** | Stop the hourly EOX ingests first, then remove them. |
| `apps/evidence-api`: server, auth-free read-only design, `/v1/artifacts/:sha256`, cursor handling | **Carry over** | Keep the artifact route unchanged. Replace `facts.ts` with price routes (§7.1, task J2). |
| `apps/evidence-api`: `/v1/changes`, `/v1/records/:id`, `/v1/records/:id/constituents`, EOX fact shape, publication policy | **Delete** | Remove after the COX routes ship; nothing in COX consumes them. |
| `apps/signer`: Cloud Run service, KMS adapters, caller auth, decode-and-allowlist policy, Firestore idempotency, key directory | **Preserve** | Unchanged service. |
| `apps/signer` roles and config | **Carry over** | Keep `oracle-operator` (Ed25519, existing KMS key) as the single COX runtime role. Bind it to the `cox` program's runtime instructions, the Pyth Solana Receiver and Wormhole verification instructions it needs, and compute budget only. Add Peter's publisher service account as the only caller. |
| `apps/signer` EVM path (`evm.ts`, EVM policy, `signEvmTransaction`) and roles `uma-asserter`, `uma-challenger`, `oracle-checker`, `evm-relayer`, `solana-relayer` | **Delete** | Disable (do not destroy) those KMS key versions; mark them `retired` in `deploy/signing/dev-keys.json` so old public keys stay verifiable. Remove the EVM code and the roles from `packages/signing`. |
| `packages/app-api` and `apps/app-api`: response envelope, typed client, fixture/live origin split, SSE stream with `Last-Event-ID` resume, state file, explicit error codes, separate status envelope | **Carry over** | New schema `cox.app-api/v1` (§7.1, task J3). |
| `packages/app-api` / `apps/app-api`: country, WORLD, pair, proposal, assertion and readiness types and routes; `fixture-source.ts`; `readiness.ts`; `live-source.ts`; `indexer.ts` EOX event decoding; `fixture-generator` (Rust on `eox-oracle-math`) | **Delete** | Replaced by COX equivalents. Keep the indexer's finalized-walk and durable-progress logic when rewriting it. |
| `deploy/dev` services `eox-app-api`, `eox-app-api-live` | **Carry over** | Same units serving the COX schema; rename to `cox-app-api(-live)` when replaced. |
| `deploy/dev` `eox-evidence-api.service` | **Preserve** | Same unit, new routes. |

### 6.2 Peter

| Existing work | Action | What to do |
|---|---|---|
| `packages/oracle/crates/math`: `SCALE`, `MathError`, `rounded_div`, `multiply`, checked bounds, domain-separated `digest`, `artifact_digest` | **Carry over** | Into `packages/cox/crates/math`, with the scales in `SYSTEM.md` §5.3. |
| `packages/oracle/crates/math`: `Rule`, `Slot`, `transform`, `normalize`, `confidence`, `calculate_indicator`, `country`, `world`, `reference`, `preview`, `parse_decimal`, `Evidence`/`Metadata` digests; `protocol.rs`, `relay.rs`, `streaming.rs` | **Delete** | Economic normalisation, confidence and UMA/Wormhole claim encoding have no COX use. |
| `packages/oracle/crates/cli`: preview binary and vector-test pattern | **Carry over** | `packages/cox/crates/cli` computes publications from a JSON input and checks the published vectors. |
| `packages/oracle/programs/eox-oracle`: registry, pause, admin-versus-runtime authority split, sequence plus predecessor, atomic latest pointer, published event, read-only simulated reader (`read_pair` pattern) | **Carry over** | Patterns for `programs/cox`. |
| `eox-oracle`: epochs, rule pages, evidence pages and history, challenges, `precommit`/`postcommit`, `close_window`, `cancel`/`expire`, `authenticated.rs` receiver; devnet program `D1HhP4kV…CYe85` | **Delete** | Stop using the devnet program; do not upgrade it. |
| `packages/oracle/PROTOCOL.md`, `RECEIVER.md`, `fixtures/*` (`protocol-v1.json`, baseline, contested, us-improves, confidence-decay), `idl/` | **Delete** | Shared EOX vectors; Godwin's Foundry tests depending on them are deleted in the same step. |
| `packages/methodology`: canonical manifest and digest approach | **Carry over** | Into `packages/cox-methodology` as `COX/METHODOLOGY/V1`. |
| `packages/methodology`: country catalogue, ISO mappings, period ordinals, confidence compiler, research bindings, calibration research, synthetic policy | **Delete** | |
| `apps/oracle-worker`: `journal.ts` (atomic state, PID lock), `retry.ts`, `solana.ts` transport (finalized reads, Anchor transactions, no fake chain), operation-ID and reconcile-before-rebuild logic | **Carry over** | Into `apps/cox-publisher`. Replace the wallet-file signer with `@eox/signing` (`oracle-operator`). |
| `apps/oracle-worker`: `provider.ts`, `worker.ts` proposal flow, `protocol.ts`, `authenticated.ts`, `publication.ts`, `references.ts`, `preview.ts`, `codec.ts`, `demo.ts`, `examples/`, `REFERENCE-READERS.md`, `AUTHENTICATED-RECEIVER.md` | **Delete** | |
| Product step 8 (exchange payoff, quote and reserve equations) and step 10 (exchange contracts) — not started | **Delete** (as tasks) | Superseded by the COX mechanism specification and the pool inside the `cox` program. |
| `docs/papers`, `docs/cox` | **Preserve** | Paper 3 is the product source. |
| Root `README.md` | **Carry over** | Rewrite for COX once the deletions land. |

### 6.3 Godwin

| Existing work | Action | What to do |
|---|---|---|
| `packages/optimistic-oracle/evm`: `EoxAssertionAdapter`, `EoxContinuousAdapter`, `ContinuousProtocol`, deploy script, interfaces, 65 Foundry tests | **Delete** | COX has no EVM chain. The annual adapter already on Sepolia is abandoned in place; record its address in the deletion commit message. |
| `packages/optimistic-oracle/solana`: `eox_settlement_oracle` | **Delete** | No annual settlement in COX. |
| `apps/uma-relay`: asserter, relay, settle/close/publish loop, `abi.ts`, `claims.ts`, `digest.ts`, `remote-sender.ts`, `server.ts`, `auth.ts`, UMA bond handling | **Delete** | |
| `apps/uma-relay`: `env.ts`, `state-file.ts`, the challenger's tick-and-cursor loop with per-item verdicts, `evidence-source.ts` artifact hash checks | **Carry over** | Into `apps/cox-monitor` (task G2). The monitor holds no key and signs nothing. |
| Trading UI from product step 3, if any exists outside this repo | **Carry over** | Keep wallet connection, layout and use of the typed client. Replace country, WORLD and pair screens with the COX screens in task G3. If nothing exists, start fresh in `apps/web`. |

## 7. New work

### 7.1 Joel

**J1 — Hermes archiver.** New `packages/ingestion/src/sources/hermes.ts` and an
archiver loop (systemd `cox-archiver` on the dev VM). For every minute cutoff,
fetch the first update with `publish_time ≥ cutoff` for every manifest feed in
one request; store the response byte-for-byte; decode each price message;
record `price_observations` with admissibility and reason (`SYSTEM.md` §3.2,
§9); record incidents for misses. Catch up missed cutoffs after a restart in
order, without inventing data. Validate ZEC: 30 days of minute cutoffs with
no more than 0.1% inadmissible; report the result to Peter before he seals the
manifest. Blocker: Hermes now requires an API key for update endpoints (§9).

**J2 — Evidence API price routes.** On `apps/evidence-api`:
`GET /v1/prices/cutoffs/:cutoff` (the archived update for a cutoff: raw-bytes
SHA-256, decoded observations, admissibility, incidents),
`GET /v1/prices/changes?after=` (commit-safe feed of new cutoffs),
`GET /v1/artifacts/:sha256` (unchanged). Read-only; never computes references.

**J3 — App API `cox.app-api/v1` and fixture.** Same envelope, client and
fixture/live split as today. Routes: deployment; assets and their feeds;
CRYPTO composition and history; latest and historical publications with
prices, CRYPTO level and references; per-class backing, units and unit value;
current batch (cutoff, open/closed) and system status (fresh, delayed,
halted, incident); a wallet's positions, pending requests, receipts,
withdrawal payable; publication stream (SSE, resumable). Fixed-point values as
integer strings with their scale. Fixture values come from Peter's vectors
(P1), never computed in the API. Error codes: `NO_PUBLICATION`,
`PUBLICATION_NOT_FOUND`, `UNKNOWN_ASSET`, `UNKNOWN_CLASS`, plus the existing
generic codes.

**J4 — Signer bindings.** After P3 deploys: bind `oracle-operator` as in §6.1,
retire the EVM and unused roles, publish the updated key directory.

**J5 — Live app API.** Indexer over finalized `cox` program events with durable
progress; positions and receipts from chain state; unsigned transaction
builders for deposit, switch, redeem, cancel and withdraw showing batch,
cutoff, amounts, conditions and expiry; submission tracking that preserves the
user's signed bytes; monitor verdicts from G2 in the status envelope.
Reconcile indexed totals with the on-chain vault and ledger every publication.
Reference history and executed-flow history are separate series.

### 7.2 Peter

**P0 — Archive tag.** Tag `main` as `eox-archive` and push it before anyone
deletes code. First task; unblocks every deletion.

**P1 — Mechanism and methodology specification.** `packages/cox/SPEC.md` plus
`packages/cox-methodology`: the `COX/METHODOLOGY/V1` manifest (assets, feed
ids, exponents, weights, origin rule, observation window, synchronisation and
`conf/price` bounds, cadence, deadlines, transfer rule id, arithmetic scales
and rounding); exact formulas for CRYPTO, references, MVP-0 and unit
accounting; request and publication state machine; account, instruction,
event and error definitions; and `packages/cox/fixtures/vectors.json` with
exact inputs and outputs, including a missed minute, an empty class, a
condition failure, an expiry and the Paper 3 §12 worked example. This is the
contract Joel and Godwin build against.

**P2 — COX math crate and simulations.** `packages/cox/crates/math` and `cli`,
passing the vectors. Run the Paper 3 §17 checks that MVP-0 must pass on
synthetic paths: equal returns leave references unchanged, deposit after a gain
cannot buy it, redeem after a loss cannot escape it, batch permutations give
identical results, split orders gain nothing from rounding, mass exit and full
drain stay backed, vault equality holds after every step. Commit the results.

**P3 — `cox` program on devnet.** Registry, pause, admin and runtime
authorities, test collateral mint and vault, classes, request accounts,
`publish` (validate Pyth accounts → reference → revalue → fix unit values →
commit), `execute` (crank batch requests at the fixed values; the next
publication cannot start until the batch is fully executed), `cancel`,
`withdraw`, halted-mode refunds, read-only simulated readers. Vault equality
asserted in every value-moving instruction. Publish program ID, IDL and the
permitted runtime instruction list to Joel.

**P4 — Publisher.** `apps/cox-publisher`: for each cutoff, read the archived
update from J2, post exactly those bytes to the Pyth receiver, call `publish`,
crank `execute` to completion, reconcile on restart, never publish a cutoff
twice. Signs only through the signer.

**P5 — End-to-end verification.** Run the devnet MVP for 24 hours with real
Pyth prices and scripted users; record publications, misses, incidents,
monitor verdicts and vault reconciliation; publish the results. This is the
MVP acceptance record.

### 7.3 Godwin

**G1 — Remove the EVM/UMA stack.** The deletions in §6.3, after P0, in one or
more `chore(cox):` commits. Confirm `pnpm -r build` and `pnpm -r test` still
pass.

**G2 — Independent monitor.** `apps/cox-monitor`: an independent TypeScript
implementation of `SYSTEM.md` §4 and §7 that matches every vector in P1. For
each finalized publication: fetch the archived update from J2 and confirm it
is the first Hermes update at or after the cutoff; check the SHA-256 and the
on-chain prices; recompute CRYPTO, references, revaluation and every executed
request; check vault equality. Emit one verdict per publication through a small
read-only HTTP endpoint that Joel's API consumes. Report mismatches; never
sign or pause.

**G3 — Web app.** `apps/web` against Joel's typed client, fixture origin first:
wallet connection; asset pages (price, COX reference, CRYPTO, next cutoff);
CRYPTO page (pilot label, members, weights, history); deposit, switch and
redeem forms showing the target batch, conditions and the estimate labelled as
an estimate, not a quote; queued, executed and rejected request states;
portfolio (units, redeemable value, deposited basis, withdrawals, pending);
withdraw; publication history; status banner (fresh, delayed, halted,
incident, monitor mismatch). MVP-0 and test collateral are labelled on every
trading screen. User keys stay in the user's wallet.

**G4 — Live user journey.** Connect G3 to the live API and demonstrate on
devnet: deposit → queued → executed; switch; redeem while another user
deposits in the same batch; withdraw; cancel before cutoff; a missed minute
seen by the user.

## 8. Execution order

| Step | Owner | Task | Depends on |
|---|---|---|---|
| 0 | Peter | P0 archive tag | — |
| 1 | Peter | P1 specification and vectors | — |
| 2 | Joel | J1 Hermes archiver (start with key request and ZEC check) | — |
| 3 | Godwin | G1 remove EVM/UMA stack | 0 |
| 4 | Joel | EOX deletions in §6.1 that nothing COX depends on (ingests, cron, Postman) | 0 |
| 5 | Joel | J2 evidence API price routes | 2 |
| 6 | Joel | J3 app API schema and fixture | 1 (fields and fixture values); skeleton can start at once |
| 7 | Godwin | G3 web app on fixture | 6 |
| 8 | Peter | P2 math crate and simulations | 1 |
| 9 | Godwin | G2 monitor against vectors | 1; live checks need 5 |
| 10 | Peter | P3 `cox` program on devnet; then Peter's §6.2 deletions | 8 |
| 11 | Joel | J4 signer bindings and role retirement | 10 |
| 12 | Peter | P4 publisher running on the dev VM | 5, 10, 11 |
| 13 | Joel | J5 live app API; then Joel's remaining §6.1 deletions | 9, 12 |
| 14 | Godwin | G4 live user journey | 7, 13 |
| 15 | Peter | P5 24-hour end-to-end verification — **MVP done** | 9, 14 |

Parallel tracks: Joel (2 → 4 → 5 → 6), Peter (1 → 8 → 10), Godwin (3 → 7, 9)
run independently until step 10. Fixture work never waits for live services.

## 9. Blockers that must stay visible

- **Joel — Hermes access:** update endpoints return `unauthorized` without an
  API key (checked 2026-10-10). Blocks J1 live, not fixtures.
- **Joel — ZEC admission:** ZEC enters the roster only if the J1 check passes
  before P1's manifest is sealed; otherwise the MVP runs with three assets.
- **Peter — transfer rule:** MVP-0 is a test mechanism. Real collateral stays
  blocked until the items in `SYSTEM.md` §12 are decided and simulated. No API
  or UI developer invents payout rules to unblock themselves.
- **Peter — Solana limits:** if one publication cannot fit Pyth posting,
  validation and revaluation within the 45-second deadline, P3 reports the
  measured limit before changing the cadence; the cadence is a product
  commitment.
- **Joel — signer funding:** `oracle-operator` must hold devnet SOL for Pyth
  posting and publication fees.

## 10. Rules for agents during the pivot

- Do not delete anything before the `eox-archive` tag exists on `origin`.
- Do not port EOX concepts by renaming: countries, WORLD, indicators,
  confidence factors, vintages, challenge windows and epochs have no COX
  meaning (Paper 3 §14).
- Do not reintroduce UMA, EVM or a challenge window into the publication path
  without a new version of this brief and `SYSTEM.md`.
- Record each finished task in `AGENTS.md`.
