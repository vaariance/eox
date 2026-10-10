# AGENTS.md

Shared log that keeps every person's coding agent in sync on this repo.
Read it in full before starting work. Add to it when you finish something
another agent needs to know.

## Rules

1. **Append-only.** Never edit or delete an existing entry. To correct or
   supersede one, append a new entry that names the earlier entry's date and
   title and says what changed.
2. **New entries go at the bottom**, in the format below.
3. **Facts, decisions and conventions only.** Record what changed, what was
   decided and by whom, and what other agents must or must not do. Link to
   READMEs and commits instead of repeating them.
4. **One entry per topic.** Keep each entry short enough to read in a minute.
5. **Commit an entry on its own** (`docs(agents): ...`), and fetch and rebase
   before pushing so entries from different people do not collide.

## Entry format

```markdown
### YYYY-MM-DD · <owner> (<agent>) · <short title>

- **Area:** <packages or folders touched>
- **What:** <what changed or was decided>
- **Rules for agents:** <must / must not, if any>
- **Open:** <unresolved questions, if any>
- **Refs:** <commits, READMEs, docs>
```

## Log

### 2026-10-06 · Joel (Claude Code) · Data layer state and repo conventions

- **Area:** `packages/evidence-store`, `packages/ingestion`, `deploy/dev`, `postman`
- **What:**
  - Ingestion covers the six indicators proven for all 30 pilot countries:
    #6 container throughput (IMF PortWatch), #17 real residential property
    prices (BIS), #21 real GDP vintages, #22 core CPI, #23 unemployment (OECD),
    #24 policy rates (BIS). Each runs live at 30/30.
  - Evidence semantics for oracle inputs: every HTTP response is stored
    byte-for-byte in `source_payloads` (SHA-256 checked by the database), each
    observation links to it via `raw_sha256`, `raw_value` keeps the source
    string, `published_at` stays empty unless the source states one, missing
    values are never zero-filled (`coverage_reported` / `coverage_total`), and
    `recorded_at` is stamped by the database and cannot be set by callers.
  - Revision detection compares value and coverage; vintaged series (GDP
    editions) are compared with the preceding edition, so missing historical
    editions are backfilled.
  - Dev server: VM `eox-dev` in GCP project `colosseum-eox`, Postgres on
    localhost only, ingests daily at 06:00 UTC.
- **Rules for agents:**
  - `observations` and `source_payloads` are append-only (database triggers).
    Never disable the triggers; fix data with `recordCorrection`.
  - `known_at` is a source claim and can be backdated. Do not use a `getAsOf`
    query as an immutable snapshot for settlement; bind exact records.
  - OECD requests must send `Accept-Language: en` (the server returns HTTP 500
    for `*`, Node's default) and should query many countries in one request
    (`AUS+BEL+...`); the API rate-limits per IP.
  - `main` is shared. Fetch and rebase before pushing or deploying, and never
    deploy a commit that is not on `origin/main`.
  - Commits: small and atomic, conventional prefixes, no AI attribution in
    messages. Source files carry no comments and no emoji.
- **Open:** whether the dispute layer uses UMA's optimistic oracle or the
  in-repo settlement and arbiter programs is being settled between Peter and
  Godwin (2026-10-06); data-layer work does not depend on the answer yet.
- **Refs:** `packages/ingestion/README.md`, `deploy/dev/README.md`,
  `postman/eox-source-apis.postman_collection.json`

### 2026-10-07 · Peter (Codex) · Upstream integration readiness review

- **Area:** Oracle, ingestion, evidence and deployment integration boundaries.
- **What:** Reviewed checkout `2b2bc66` after Peter resolved the dependency conflict. The annual optimistic settlement flow and continuous evidence oracle are separate implementations with different event and commitment contracts. The worker still uses fixture evidence.
- **Rules for agents:** Do not treat the annual final-result relay as a per-record challenge adapter. Preserve the publication-time readiness rule until a versioned replacement policy is agreed. Do not equate stored rounded values with exact raw source strings.
- **Open:** Shared methodology output contract, live evidence provider, publication-time policy, dispute event integration and operated worker/relay services.
- **Refs:** `docs/oracle/upstream-readiness.md`, `docs/oracle/results/README.md`.

### 2026-10-07 · Peter (Codex) · Explicit methodology policy compiler

- **Area:** `packages/methodology`, oracle-worker integration tests, `docs/oracle`.
- **What:** Added an explicit six-indicator policy compiler, 30-country catalogue, ISO mappings, native calendar ordinals, exact GDP scaling, portable manifest and synthetic example. Ten package tests and 28 worker tests pass, including Rust preview integration.
- **Rules for agents:** Synthetic anchors are not calibrated economic claims. Preserve stable source series identities across policy versions. The portable manifest digest is not a Solana deployment commitment or executable image ID. Do not invent publication times or silently round source values.
- **Open:** Live calibration, GDP edition selection, reproducible port aggregation and the live evidence/dispute adapters. No methodology deployment in this step.
- **Refs:** `packages/methodology/README.md`, `docs/oracle/methodology-integration.md`.

### 2026-10-07 · Peter (Codex) · Calibration sensitivity review

- **Area:** `packages/methodology/research`, `docs/oracle/calibration-proposal.md`.
- **What:** Added reproducible synthetic Rust sensitivity scenarios and a proposed indicator interpretation. Year-old comparison observations drive four comparison-dependent slots to zero confidence under the current freshness rule; economic outputs remain unchanged. Equal-weight stress parameters produce large EOX-20 moves.
- **Rules for agents:** Research targets and bounds are not calibrated live parameters. Do not restamp historical observations or widen freshness merely to hide historical-comparison decay. The proposed smaller scored profile and alternative historical-confidence treatment are not implemented or approved.
- **Open:** Peter's review of score interpretation, immutable historical calibration data, and any separately versioned confidence/profile changes.
- **Refs:** `docs/oracle/calibration-proposal.md`, `docs/oracle/results/calibration/sensitivity.json`.

### 2026-10-07 · Peter (Codex) · Geffy research baseline clarification

- **Area:** Methodology research and calibration proposal.
- **What:** Peter supplied Geffy's 25-indicator data availability and ingestion audit. Qualifies the earlier 2026-10-07 Calibration sensitivity review: its smaller scored profile is only a hypothesis and must be reconciled with this existing research.
- **Rules for agents:** Read supplied team research before proposing a replacement shortlist. The audit's data-infrastructure scores are not economic weights or per-observation confidence. Match findings to the actual selected source and country; preserve provisional coverage qualifications.
- **Open:** Economic calibration and explicit mapping from source research to confidence policy.
- **Refs:** `docs/oracle/calibration-proposal.md`; <https://docs.google.com/document/d/1jR1YtxBS1-l67OBeQe0LPM9N5irLiwUDIokuqyS3epg/edit>.

### 2026-10-07 · Peter (Codex) · Research bindings and confidence assertions

- **Area:** `packages/methodology`, worker integration tests, `docs/oracle`.
- **What:** Added six pilot audit bindings and a named eight-factor assertion compiler. It binds record/payload, assessor, rating rubric, source policy and supporting digests into a canonical manifest and emits the existing worker tuple. Sixteen methodology tests and 29 worker tests cover this integration.
- **Rules for agents:** The compiler checks structure, not assertion truth or assessor authentication. Live adapters must verify referenced artifacts and use the source authority pinned by the configured rule. Audit ratings never become economic weights or confidence by automatic scaling. All six indicators remain under review; no roster or arithmetic changed.
- **Open:** Historical calibration data, numerical rating rubrics, economic parameters and live provider integration. Do not claim the helper is already wired to live evidence.
- **Refs:** `packages/methodology/README.md`, `docs/oracle/geffy-methodology-contract.md`.

### 2026-10-08 · Joel (Claude Code) · System contract v1 proposed

- **Area:** every package; new root file `SYSTEM.md`.
- **What:** Consolidated the time frames, data types, storage, commitment identities and the meaning of pre-commitment, challenge and post-commitment into `SYSTEM.md`, at Peter's request. It separates the three clocks that were being mixed: the data clock (native source periods, polled daily), the reference clock (continuous proposals; 60 s devnet challenge window) and the settlement clock (annual epoch, cutoff 31 July of the following year, 72 h UMA liveness). It proposes the six indicators as the v1 live set, the evidence adapter mapping, a commit-safe change cursor, a precision rule and a publication-time policy.
- **Rules for agents:** Read `SYSTEM.md` before working. Its PROPOSED and OPEN items are not decisions until the sign-off table in §9 is filled in. `SYSTEM.md` is versioned, not append-only: change it only with a version bump, the named owners' sign-off and a new entry here.
- **Open:** All §9 sign-offs, especially continuous challenge authentication (§6.3) and the mapping from continuous references to the annual claim (§6.4), both for Peter and Godwin.
- **Refs:** `SYSTEM.md`; earlier entry 2026-10-07 · Peter (Codex) · Upstream integration readiness review. The `docs/oracle/...` files cited in earlier entries are gitignored and exist only locally.

### 2026-10-08 · Joel (Claude Code) · Live evidence API deployed

- **Area:** `packages/evidence-store`, new `apps/evidence-api`, `deploy/dev`.
- **What:** Implemented `SYSTEM.md` §5.5–5.6. Migration `007` stamps each observation with its inserting transaction ID; `readChanges` only returns rows older than every running transaction, so a late commit is never skipped. `apps/evidence-api` serves `GET /v1/changes`, `/v1/records/:recordId` and `/v1/artifacts/:sha256`, read-only, on `127.0.0.1:8787` of the dev VM (systemd `eox-evidence-api`). Verified on the VM at `afd7c58`: 15,291 of 15,291 observations served once each, all six indicators for all 30 countries, 38 of 38 artifacts hash-verified.
- **Rules for agents:** The worker must read evidence through this API, never the database. Record IDs are `eox:observation:<id>`, change IDs `eox:change:<id>`; cursors are opaque. Facts omit `confidenceBps`, `manifest` and `comparisonRecordId` (methodology side) and carry `publishedAt: null` until the §5.4 policy exists, so the worker's readiness check rejects them by design. When selecting text-cast columns in SQL, always qualify `ORDER BY observations.id`: an unqualified `id` sorts the text alias and silently skips rows.
- **Open:** Peter: an HTTP `EvidenceProvider` in the worker pointed at this API, plus the §5.3 precision and §5.4 publication-time decisions. The worker's journal tests fail on Windows (`EPERM` on directory fsync) but pass on Linux (23 pass, 6 skipped).
- **Refs:** `apps/evidence-api/README.md`, `SYSTEM.md` §5, commits `d8c99d7`..`afd7c58`.

### 2026-10-08 · Joel (Claude Code) · Dev database backups

- **Area:** `deploy/dev`, GCP project `colosseum-eox`.
- **What:** Closes the backup gap in `SYSTEM.md` §5.7. The dev VM dumps Postgres daily at 05:30 UTC (`pg_dump --format=custom`, validated with `pg_restore --list`) to `gs://colosseum-eox-db-backups`, which blocks public access and deletes objects after 30 days. The VM now runs as service account `eox-dev-vm`, which can only create objects in that bucket, so it cannot read, overwrite or delete backups. A restore of the first backup was verified: 15,291 observations, 38 payloads with valid hashes, 7 migrations and working append-only triggers.
- **Rules for agents:** Never restore over the live `eox` database; restore into a new database and point `DATABASE_URL` at it. Do not widen the VM service account's bucket role. The VM's external IP changed to `35.193.103.79`; address the VM by instance name, not IP.
- **Open:** Backups cover the dev database only; testnet and production need their own policy.
- **Refs:** `deploy/dev/README.md` (Backups and restore), commits `44a0d9c`, `a9908d3`.

### 2026-10-08 · Peter (Codex) · Historical calibration pilot captured

- **Area:** `packages/methodology/research`, `docs/oracle/results/history-pilot`.
- **What:** Captured 2019–2025 OECD/BIS history for US/JP/NZ plus two seven-day PortWatch samples. Twelve successful responses and 29 data files have a sealed hash manifest; inventories rebuild offline. GDP retains source editions; no publication timestamps were invented.
- **Rules for agents:** This is exploratory calibration evidence, not release-time replay or oracle-ready input. Keep Japanese CPI excess precision rejected and US October 2025 CPI/unemployment missing. Preserve alternative CPI routes and GDP editions separately. Do not change sealed source files to fit policy; use a new dataset version.
- **Open:** Full PortWatch history/aggregation, complete roster, source publication evidence, explicit precision decisions and live economic calibration.
- **Refs:** `docs/oracle/historical-data-report.md`, `docs/oracle/results/history-pilot/manifest.json`.

### 2026-10-09 · Peter (Codex) · Separate product direction for review

- **Area:** New root `product.md`; `SYSTEM.md` unchanged.
- **What:** At Peter's request, documented the product in plain English: continuous trading on the previous accepted reference, hourly evidence preparation, a further one-hour challenge window, authenticated outcomes and publication on Solana. Annual settlement is not a required step in this product direction. The document awaits product review and does not claim team sign-off.
- **Rules for agents:** Keep the product brief separate from the engineering contract, as Peter explicitly requested. Do not rewrite `SYSTEM.md` as part of this task. Do not treat existing annual code as an approved trading lock or the new timing direction as already deployed. Read the unresolved integration and exchange decisions in `product.md` before implementation.
- **Open:** Product review, continuous UMA contract, overlapping/disputed proposal scheduling, live methodology/data policies and exchange ownership/accounting.
- **Refs:** `product.md`; qualifies the product assumptions in the 2026-10-08 System contract v1 proposed entry without editing that contract.

### 2026-10-09 · Peter (Codex) · Product v1 rules pinned in separate brief

- **Area:** `product.md` version 2; `SYSTEM.md` unchanged.
- **What:** Peter requested concrete rules inside the product brief, without a question round. Replaced its open-decision table with evidence plus snapshot assertions, one-hour windows, authenticated relay, one active proposal, strict publication-time/exact-precision admission, explicit GDP/port selection, retained v0.1 confidence arithmetic, calibration activation requirements, test-asset launch boundary and incident/staleness behavior.
- **Rules for agents:** These are target requirements, not deployed behavior or other developers' sign-off. Preserve evidence-level dispute attribution; a rejected snapshot does not identify a guilty record. Keep real-money deposits disabled until the complete exchange payoff/reserve specification and verification exist. Do not invent calibration results to fill the methodology artifact. Read section 8 before aligning implementation; do not silently update `SYSTEM.md`.
- **Open:** Implementation, measured calibration artifact and exchange payoff/reserve equations remain deliverables under the pinned activation rules.
- **Refs:** `product.md` sections 8–9; supersedes the open-decision list described in the earlier 2026-10-09 Separate product direction for review entry.

### 2026-10-09 · Peter (Codex) · Explicit assertion relay and admission contract

- **Area:** `product.md` version 3; engineering code and `SYSTEM.md` unchanged.
- **What:** At Peter's request, replaced coordination wording with explicit claim contents, evidence/snapshot assertion registration, authenticated relay event and closure requirements, timestamp provenance, revision selection and exact six-decimal admission examples.
- **Rules for agents:** Snapshot claims commit the evidence-assertion list; their own returned UMA ID is registered afterward, avoiding a self-referential commitment. Closure verifies that list plus the registered snapshot assertion. No timestamp guesses, silent decimal rounding, cross-proposal replay or relay-invented evidence verdicts. These are implementation requirements, not a claim of completed integration.
- **Open:** Implement the shared encoding vectors, UMA/relay integration and admission checks under the documented contract.
- **Refs:** `product.md` sections 6, 8.1, 8.2 and 8.4.

### 2026-10-09 · Peter (Codex) · Individual ownership and app handoff

- **Area:** `product.md` version 4; `SYSTEM.md` unchanged.
- **What:** Peter requested single-owner obligations instead of joint attribution. Split assertion, relay, evidence admission and incident duties into each developer's producer/consumer responsibilities. Added Peter-owned app client/API requirements, fixture handoff and individual pass/fail delivery checklists.
- **Rules for agents:** Joel owns source facts and evidence service; Godwin owns UMA assertions, authenticated EVM outcomes and relay delivery; Peter owns schemas/test vectors, input admission, Solana verification/publication and app-facing integration. No handoff is assigned merely to a pair of developers. App work can start on the fixed client/fixture contract; live-data integration and real-money launch have separate acceptance gates. Do not report integration complete merely because the document is updated.
- **Open:** Execute the individually assigned deliverables and record test evidence; no new joint policy meeting is required by this brief.
- **Refs:** `product.md` sections 8–9; supersedes joint owner wording in earlier product brief entries.

### 2026-10-09 · Peter (Codex) · Direct developer assignments

- **Area:** `product.md` version 5.
- **What:** Peter clarified that responsibility must be written as direct implementation assignments, not coordination or acceptance checklists. Section 6 now has exactly three developer assignments: Peter builds methodology/reference calculation and Solana publication, Godwin builds repeated UMA assertion/dispute/relay processing, Joel builds immutable source evidence supply. Each ends with its concrete handoff. Removed duplicated ownership blocks and the long closing checklist while retaining detailed contract rules.
- **Rules for agents:** When asked to clarify task boundaries, state what each person builds, why it exists and what the next component consumes. Do not substitute questions, sign-off language or process checklists for the implementation assignment.
- **Refs:** `product.md` sections 6 and 9.

### 2026-10-09 · Peter (Codex) · Correct scope of CODE contract rules

- **Area:** `product.md` version 6, section 8; `SYSTEM.md` unchanged.
- **What:** Peter clarified that generic developer assignments do not answer this task. Rebuilt section 8 around specific SYSTEM.md mismatches, each with source-section references and individual implementation changes. Covers annual versus continuous flow, incompatible clocks, assertion/relay authentication, input mapping, timestamps, precision, revisions, confidence, methodology, deployment and app handoff. Reduced section 6 to a short ownership note.
- **Rules for agents:** Resolve the identified infrastructure mismatch in section 8 itself. Name the existing conflict, then the exact change each affected owner must make; do not replace it with role summaries, coordination questions or generic checklists. Solana must bind authenticated UMA assertion deadlines rather than infer them from pre-commit time.
- **Refs:** `product.md` section 8; corrects the scope of the earlier 2026-10-09 Direct developer assignments entry.

### 2026-10-09 · Peter (Codex) · Signing service and ordered trading-app work

- **Area:** `product.md` version 7, sections 8.12–8.15 and 9.
- **What:** Peter requested Joel-owned shared infrastructure signing and explicitly assigned trading UI to Godwin, contracts to Peter, and APIs/service integrations to Joel. Added a remote signer/client, role-separated keys, public-key directory, exact connection points, user-wallet boundary, and 16 ordered tasks with parallel tracks and blockers. Reassigned app API/client ownership from Peter to Joel; Peter retains chain schemas and deterministic reference readers.
- **Rules for agents:** One signing interface does not mean one shared key. Keep role/chain/environment keys separate, reject arbitrary signing, exclude admin upgrades and user trades, and retain real UMA/Wormhole verification. Create public key identities before deploying and binding contract addresses. UI starts against Joel's fixture API; live-data and real-money completion require their separate gates. This is a documented implementation plan, not a signer or app deployment.
- **Open:** Execute section 9; missing publication evidence, calibration, operating funds and exchange equations are named implementation blockers, not silently waived requirements.
- **Refs:** `product.md` sections 8.14, 8.15 and 9; supersedes prior entries assigning app APIs to Peter.

### 2026-10-09 · Joel (Claude Code) · Step 2: app API, signing types and fixture API

- **Area:** new `packages/app-api`, `packages/signing`, `apps/app-api`.
- **What:** Delivered `product.md` §9 step 2. `@eox/app-api` is the versioned schema (`eox.app-api/v1`) and typed client; `apps/app-api` serves it from a `ReferenceSource` port, with a fixture source today. Routes: latest and historical snapshots, country/WORLD, country/country pairs, current proposal with UMA assertions, evidence readiness, paged and streamed (resumable) finalized publications, explicit `NO_ACCEPTED_REFERENCE`, `SNAPSHOT_NOT_FOUND`, `INVALID_PAIR`. Fixture values are computed by `eox-oracle-math` (`preview` and `reference`) over `packages/oracle/fixtures` baseline and us-improves, via `apps/app-api/fixture-generator` in Docker. `@eox/signing` defines the §8.14 request/result/key-directory types and a validating client.
- **Rules for agents:** UI work (Godwin, step 3) uses `createAppApiClient` against `pnpm --filter @eox/app-api-server start`. Never compute references in the API or UI; values come from the oracle. Fixed-point values are integer strings at scale 1,000,000; parse with `BigInt`. Regenerate `fixtures/oracle-preview.json` whenever `packages/oracle/fixtures` changes; a test enforces this.
- **Open:** Snapshot identity fields are provisional until Peter publishes step 1 (claim/relay schemas, account layouts, readers). Trading endpoints wait for Peter's step 8 equations and instruction definitions. The signing service itself is step 4.
- **Refs:** `apps/app-api/README.md`, `packages/signing/README.md`, commits `b74af20`..`5e73253`.

### 2026-10-09 · Joel (Claude Code) · Dev signing key identities published

- **Area:** GCP `colosseum-eox` Cloud KMS, `apps/signer`, `deploy/signing/dev-keys.json`.
- **What:** First part of `product.md` step 4. Key ring `eox-signing-dev` (us-central1) holds one non-exportable key per role: `oracle-operator` and `solana-relayer` are Ed25519 (software protection; Cloud KMS does not offer Ed25519 at HSM level), `uma-asserter`, `uma-challenger`, `oracle-checker` and `evm-relayer` are secp256k1 (HSM). Only service account `eox-signer` may sign with them. Public keys and addresses are in `deploy/signing/dev-keys.json` (Solana devnet and Sepolia), generated from KMS by `apps/signer/scripts/key-directory.ts`.
- **Rules for agents:** Deploy dev contracts with the authorities in `deploy/signing/dev-keys.json` and pin those addresses on chain. Never create or use another copy of these roles' private keys. Admin and upgrade authorities are not in this directory and must stay outside the signing service. Signing stays disabled for every target until its deployed address is bound in `apps/signer/config/dev.json`; send Joel the deployed program IDs, contract addresses and permitted instructions/selectors.
- **Open:** The signing service itself (KMS adapters, policy, idempotency, Cloud Run deployment) is still in progress. The operational accounts are unfunded.
- **Refs:** `deploy/signing/dev-keys.json`, `apps/signer/config/dev.json`, commits `21ba045`..`376731d`.

### 2026-10-09 · Joel (Claude Code) · Signing service deployed (step 4)

- **Area:** `apps/signer`, `packages/signing`, GCP `colosseum-eox` (Cloud KMS, Cloud Run, Firestore, Artifact Registry).
- **What:** The `product.md` §8.14 signing service runs privately on Cloud Run at `https://eox-signer-529206295845.us-central1.run.app` as service account `eox-signer`, the only identity allowed to sign with the `eox-signing-dev` KMS keys. It authenticates callers by Google identity token, decodes each Solana/EVM transaction, enforces per-role bindings (contracts/selectors/limits; programs/discriminators/compute price; no lookup tables, contract creation or EIP-7702), records every decision in Firestore for request-ID idempotency (`REQUEST_ID_CONFLICT` on changed bytes) and verifies each KMS signature before returning it. KMS signatures were verified on Solana devnet and by local EVM recovery; 25 signer tests pass.
- **Rules for agents:** Call the signer only through `createSigningClient` from `@eox/signing`, with an identity token for audience `https://eox-signer-529206295845.us-central1.run.app`. Each caller needs its own service account, listed in `apps/signer/config/dev.json` `callers` and granted `roles/run.invoker`; ask Joel. Signing stays disabled until your deployed program IDs or contract addresses and permitted instructions/selectors are bound in that config. Never hold a local copy of a role key.
- **Open:** Caller service accounts (Peter: oracle worker and checker; Godwin: asserter, challenger, EVM and Solana relayers), target bindings after deployment, and funding the six dev accounts for broadcast proofs.
- **Refs:** `apps/signer/README.md`, `deploy/signing/dev-keys.json`, image `signer:24bb26d`.

### 2026-10-09 · Joel (Claude Code) · Step 5: hourly ingestion, exact ports, revisions, release evidence

- **Area:** `deploy/dev`, `packages/ingestion`, `packages/evidence-store` (migrations `008`, `009`), `apps/evidence-api`.
- **What:** `product.md` §8.2 and §8.6–8.9. Ingests run hourly at :05 with a lock per job (overlaps are skipped) and a 50-minute limit. Port values are read as exact source text and summed exactly; `GET /v1/records/:id/constituents` serves every port/day import/export value from the stored artifact. Each revision links the version it revises (`revision.revises`) with its order basis (`source-edition` for GDP editions, `retrieval` otherwise). A publication time now requires a linked source release (enforced by the database). For PortWatch, a day is dated by the layer's `dataLastEditDate` at which it first appears, proven by the archived current and previous release responses (`publication` block on the fact).
- **Rules for agents:** Never set `published_at` without a `source_releases` link; the database rejects it. `publishedAt` on a fact is exact whole seconds or `null`; the exact time is `publication.release.releasedAtMs`. Port aggregation must use the constituents, not the normalised `value`.
- **Open:** Source-readiness blocker report for v1 admission (§8.7): all 180 slots are blocked. 150 (OECD `gdp_real_volume`, `cpi_core_yoy`, `unemployment_rate`; BIS `policy_rate`, `residential_property_price_real`; 30 countries each) have no machine-readable actual-release evidence from the source, so `publishedAt` stays null (`MISSING_PUBLICATION_TIME`). 30 (`container_throughput`) get release evidence from the next PortWatch data edit onward, but PortWatch edit times carry milliseconds, which v1's whole-second rule rejects (`INVALID_PUBLICATION_TIME`). Peter to decide the admission rule; Joel will not round or invent times.
- **Refs:** `packages/ingestion/README.md` (Publication time), `apps/evidence-api/README.md`, commits `e6417cf`..`b057b03`.

### 2026-10-09 · Peter (Codex) · Task 1 oracle integration interfaces

- **Area:** `apps/oracle-worker`, `packages/oracle`.
- **What:** Published continuous claim/relay Borsh schemas, matching TypeScript/Rust encoders and 12 shared byte/hash vectors. Added finalized account readers, historical epoch/baseline validation, current account/event layouts and a minimal Joel-facing example. Existing pair reads still simulate the on-chain instruction. Verification: 50 worker, 16 methodology and 27 Rust tests pass; worker type-check passes.
- **Rules for agents:** Godwin uses `packages/oracle/PROTOCOL.md`; Joel uses `apps/oracle-worker/REFERENCE-READERS.md`. Relay subjects are full claim digests. Snapshot claims exclude their own returned assertion ID; closure adds it separately. Configuration and portable manifest identities remain distinct. These formats do not implement authenticated relay acceptance; that remains task 2. Network-specific adapter/emitter pinning is required because the wire destination contains program/registry, not a genesis hash. No economics, signer, HTTP API or deployment changed.
- **Refs:** `packages/oracle/fixtures/protocol-v1.json`, `apps/oracle-worker/examples/read-reference.ts`, `product.md` section 9 task 1.

### 2026-10-10 · Joel (Claude Code) · Publication-time policy decided by Peter

- **Area:** `apps/evidence-api`; supersedes the publication blocker in the 2026-10-09 "Step 5: hourly ingestion, exact ports, revisions, release evidence" entry and overrides `product.md` §8.7's ban on first-retrieval time.
- **What:** Peter decided (2026-10-10): when the source gives no publication time, use the time EOX first observed the record; for PortWatch release times, drop the milliseconds by rounding down. The evidence API now serves every fact with `publishedAt` in whole seconds under policy `PUBLICATION/RELEASE-OR-FIRST-OBSERVED/V1`: verified source release time when one exists (`basis: "source-data-edit"`), otherwise the database-stamped `recordedAt` (`basis: "first-observed"`). Stored data is unchanged. Verified on the dev VM at `f01e5f4`: 15,622 of 15,622 facts carry a whole-second `publishedAt`.
- **Rules for agents:** Read `publication.basis` and `publication.policy`; never treat a `first-observed` time as the source's release time. For backfilled history, first observation is the load date, so freshness looks better than it is; use `knownAt` and `revision.sourceEdition` for the source's own dating. Do not round or substitute times anywhere else.
- **Open:** Whether methodology freshness should treat `first-observed` records differently (Peter).
- **Refs:** `apps/evidence-api/README.md`, `packages/ingestion/README.md`, commits `6ff76a2`..`f01e5f4`.

### 2026-10-10 · Joel (Claude Code) · Step 9: live app API on devnet

- **Area:** `apps/app-api`, `packages/app-api`, `deploy/dev`.
- **What:** The app API has a live source behind the same `ReferenceSource` interface as the fixture. An indexer walks the `eox-oracle` registry's finalized transactions, skips failed ones, and keeps a `ReferencePublished` event only when Peter's `ReferenceReader` reads that snapshot as published with the same sequence, epoch and postcommitment. Pairs come from simulating `read_pair` at `finalized`; nothing is signed. Readiness follows the evidence change feed for all 180 pilot slots with the worker's `assertReady` rules. Runs on the dev VM as `eox-app-api-live` at `127.0.0.1:8791`; the fixture stays on 8790. Verified at `39cf5f0`: devnet publications 0, 1, 3 and 4 indexed; the US/JP pair is served from the program; all 180 slots are `missing-assessment`.
- **Rules for agents:** `GET /v1/publications` without `after` now starts at sequence 0, the on-chain baseline; `nextAfter` is `null` until a publication is returned, and `subscribePublications(null, ...)` streams from the start. Readiness never reports `ready` until confidence assessments exist. `configurationDigest` is the on-chain configuration, not the methodology manifest digest. `assertions` stays empty until challenges go through UMA (`SYSTEM.md` §6.3).
- **Open:** The public devnet RPC rate-limits (HTTP 429), so indexing is slow; a dedicated RPC endpoint would fix it. Trading endpoints wait on Peter's step 8.
- **Refs:** `apps/app-api/README.md` (The live source), `deploy/dev/README.md`, commits `2de4e6d`..`39cf5f0`.

### 2026-10-10 · Godwin (Claude Code) · Continuous UMA adapter on main, not yet deployed

- **Area:** `packages/optimistic-oracle/evm`; first part of `product.md` §9 step 7.
- **What:** `EoxContinuousAdapter` implements the EVM side of `product.md` §8.1–8.5 against `packages/oracle/PROTOCOL.md`. Allowlisted asserters post evidence and snapshot claims as full Borsh bytes; the adapter rejects a claim whose context is not this chain, this adapter, the pinned Solana program and registry, and an epoch its owner opened with the same manifest, configuration digest and evidence policy. Every assertion uses 3,600 s liveness and UMA's current minimum bond. A snapshot registers only if each listed evidence assertion was registered here with the same record, evidence, assessment and context; a proposal takes one snapshot and then accepts no more evidence. An identical claim returns its existing assertion ID. Registered, Disputed, Settled and Closed are recorded as relay messages with the per-proposal event number and history; the message bytes are emitted in `RelayMessageRecorded` and only their digest is stored. `publish` sends a recorded message to Wormhole (consistency level 1) and may be repeated. `ContinuousProtocol.sol` is tested byte for byte against `packages/oracle/fixtures/protocol-v1.json`; 65 Foundry tests pass. The deploy script was simulated against Ethereum Sepolia (UMA minimum bond 0.002 WETH, Wormhole chain 10002). Comments were removed from the whole package except SPDX lines, Anchor's `CHECK` and the generated ABI header.
- **Rules for agents:** The yearly `EoxAssertionAdapter` and `eox_settlement_oracle` are unchanged and are not part of the continuous path. Evidence must be asserted with the proposal address and precommitment before its snapshot, so the Solana pre-commitment comes first. Evidence messages carry the header of the proposal they were first registered under; reused evidence emits nothing new. `close` succeeds only when every assertion registered under the proposal and every required assertion has resolved, including for a rejection, so no message follows closure. The dispute ID is `keccak256(abi.encode(chainId, UMA address, assertionId, disputer))`. The adapter's Solana program and registry are immutable: a new program or registry needs a new adapter. Changing `protocol-v1.json` fails `forge test` in this package.
- **Open:** Deployment waits on Peter: he said on 2026-10-10 that the devnet program ID `D1HhP4kVA73bj6c4MfX5yzMZDvQRx5DTRP3xpC2YCe85` will change with the Wormhole receiver, and the adapter needs the new program ID, registry, epoch number, methodology manifest digest, configuration digest and evidence policy hash. Peter then pins the adapter address and Wormhole emitter chain. Joel: signer bindings for `uma-asserter` (`assertEvidence`, `assertSnapshot`, bond-token `approve`) and `evm-relayer` (`close`, `publish`, UMA `settleAssertion`) follow the deployment. Testnet choice (Ethereum Sepolia as in `SYSTEM.md` §7, or Base Sepolia where UMA's minimum bond is 0 and only its TestnetERC20 is whitelisted) is unconfirmed. Each new evidence record is its own bonded UMA assertion, so a first 30-country proposal can need several hundred. The assertion, settlement, challenger and relay services and the Solana delivery are not built yet.
- **Refs:** `packages/optimistic-oracle/README.md` (Deploy the continuous adapter), `packages/optimistic-oracle/evm/src/EoxContinuousAdapter.sol`, commits `1e7891b`..`58b5fc6`.

### 2026-10-10 · Godwin (Claude Code) · UMA assertion and relay service; SDK removed

- **Area:** new `apps/uma-relay`; `packages/optimistic-oracle` (SDK removed); second part of `product.md` §9 step 7.
- **What:** `apps/uma-relay` is the service that operates `EoxContinuousAdapter`. It posts claims on request: `POST /v1/assertions/evidence` (`proposal`, `precommitment`, `claim`) and `POST /v1/assertions/snapshot` (`claim`), each returning `assertionId`, `claimDigest` and `created` under schema `eox.uma-relay/v1`. Callers present a Google identity token for a service account listed in `ASSERTION_CALLERS`. A repeated claim returns its existing assertion and pays no second bond; a claim the adapter would refuse is not sent and returns 422 `CLAIM_REJECTED` with the adapter's error name; a wallet that cannot cover one bond returns 503 `UNDERFUNDED`. Each tick it also settles expired assertions on UMA, closes proposals whose assertions have all resolved and publishes recorded messages to Wormhole, simulating every transaction first and reconciling in-flight transactions from a durable state file after a restart. It signs only through `@eox/signing`: `uma-asserter` for claims and bond-token approvals (16 bonds at a time), `evm-relayer` for the rest. `packages/optimistic-oracle/sdk` is deleted: it only covered the yearly adapter and nothing imported it. Supersedes the statement in the 2026-10-10 "Continuous UMA adapter on main, not yet deployed" entry that the assertion, settlement and relay services are not built. 29 service tests and 65 Foundry tests pass; the service tests post claims built with `@eox/oracle-worker/protocol`.
- **Rules for agents:** The worker requests assertions from this service and does not hold `uma-asserter`: evidence first, then the snapshot carrying the returned IDs. There is no shared client for the adapter; write calls from its interface and events. The remote-signer wiring that `product.md` §8.14 points to at `packages/optimistic-oracle/sdk/src/evm.ts` is now `apps/uma-relay/src/remote-sender.ts`. The service never holds a private key; tests use local Anvil keys behind the same `Sender` interface.
- **Open:** Nothing here has run against the real signer or a testnet: it needs the deployed adapter, which still waits on Peter's new program ID. Joel: one service account for this service as a caller with `uma-asserter` (adapter `assertEvidence`, `assertSnapshot`; bond-token `approve`) and `evm-relayer` (adapter `close`, `publish`; UMA `settleAssertion`), and a place to run it on Google Cloud. Peter: the worker's service account email for `ASSERTION_CALLERS`. Not built: fetching the signed Wormhole message and delivering it to the Solana receiver, and the challenger.
- **Refs:** `apps/uma-relay/README.md`, commits `28323a6`..`4cd4c08`.

### 2026-10-10 · Godwin (Claude Code) · UMA challenger added, watch-only by default

- **Area:** `apps/uma-relay`; third part of `product.md` §9 step 7.
- **What:** The challenger is a second process in `apps/uma-relay` (`pnpm --filter @eox/uma-relay challenger`) that signs with the `uma-challenger` key through `@eox/signing`. Each tick it reads new evidence claims from the adapter's events, decodes them with the shared protocol encoding and checks that the claim's source record and every source artifact exist in Joel's evidence API with matching hashes. It reports a verdict per claim and disputes on UMA only when `CHALLENGER_DISPUTE=true`. It keeps its cursor and verdicts in its own state file. Supersedes the statement in the 2026-10-10 "UMA assertion and relay service; SDK removed" entry that the challenger is not built. 48 service tests pass, including a run against the adapter on Anvil.
- **Rules for agents:** A claim the challenger reports as supported has only had its record and artifacts checked; that is not a check of the claim's evidence digest, metadata digest or assessment. Snapshot claims are not checked at all. Do not describe either as verified by the challenger. Give the relay and the challenger different state files. Peter's independent checker uses the separate `oracle-checker` key, not `uma-challenger`.
- **Open:** Peter: where a challenger can fetch the confidence assessment manifest behind a claim's `assessment_digest`, and whether that digest is `compileConfidence`'s `manifestDigest`; the digest check needs the eight ratings and no assessments exist yet. Joel: a caller entry for the challenger's service account with `uma-challenger` (UMA `disputeAssertion`, bond-token `approve`). Still not built: delivering the signed Wormhole message to the Solana receiver.
- **Refs:** `apps/uma-relay/README.md` (Challenging), commits `b2396e9`..`137c868`.

### 2026-10-09 · Peter (Codex) · Authenticated receiver foundations in progress

- **Area:** `packages/oracle/crates/math`, CLI verification tests.
- **What:** Added bounded streaming commitment hashing and strict continuous posted-VAA decoding/identity checks. Rust tests cover shared vectors, malformed proofs, restart/padding boundaries and maximum-roster claim streaming. These are unwired library helpers; the Solana acceptance path is unchanged.
- **Rules for agents:** This work belongs to product step 6, correcting the informal "task 2" receiver label in the earlier Task 1 entry. Do not describe it as a completed authenticated receiver. The instruction must derive proof ownership from AccountInfo and settings from pinned program-owned accounts, never caller-supplied claims. Injected proof tests are not guardian-verification evidence. No live publication-time policy was changed.
- **Open:** Companion accounts, staged binding validation, assertion/receipt lifecycle, closure gate, worker recovery, IDL and compiled-program verification remain. Parallel implementation agents hit the service usage limit before making changes.
- **Refs:** `packages/oracle/RECEIVER.md`.

### 2026-10-10 · Peter (Codex) · Publication-time admission approved

- **Area:** `product.md` version 8, oracle-worker admission and evidence encoding.
- **What:** Peter explicitly approved OECD/BIS first-observed time when source publication time is missing, and dropping PortWatch milliseconds with floor-to-seconds conversion. `EOX/PUBLICATION/V2` now applies in worker readiness and Rust input adaptation; time basis is committed in metadata. Source-value precision remains unchanged.
- **Rules for agents:** Joel supplies immutable database `recordedAt` for OECD/BIS; later polls must not reset it. PortWatch uses `floor(releasedAtMs / 1000)`; retaining the milliseconds is not an additional admission requirement. Godwin validates the same policy. These decisions supersede the strict timestamp-admission requirements in the 2026-10-09 Explicit assertion relay and admission contract entry and resolve the time-specific blockers in Joel's 2026-10-09 Step 5 entry. Do not keep asking Peter to reconfirm these decisions.
- **Open:** Live adapter, confidence assessments and economic calibration remain separate deliverables; this change does not claim all source slots are live.
- **Refs:** `product.md` §8.7, `apps/oracle-worker/src/publication.ts`, `apps/oracle-worker/test/publication.test.ts`.


### 2026-10-10 · Peter (Codex) · COX Paper 3 draft

- **Area:** `docs/cox`, `output/pdf/cox_paper_3.pdf`.
- **What:** Produced a standalone 22-page Crypto Outlook Index product/system draft from Peter's price-only direction: shared CRYPTO reference, one-minute publications, next-publication execution and continuous closed-collateral participation. Includes equations, diagrams, worked accounting and source references. Arithmetic, links and rendered layout checked; two independent reviews completed.
- **Rules for agents:** This is a review draft, not a deployed mechanism or an amendment to EOX `SYSTEM.md`. Do not introduce fundamentals, market-cap growth, volume scoring, mandatory terminal epochs or a signal multiplier. Preserve the distinction between COX reference and redeemable value; the illustrative normalized transfer formula is not selected and its common benchmark cancels.
- **Open:** Benchmark policy, final transfer rule, holdable CRYPTO rights, source/cutoff rules, exceptional states and production proofs.
- **Refs:** `docs/cox/cox-paper-3.md`, `docs/cox/build_pdf.py`, `docs/cox/verification.json`; EOX Paper 3 and RPM Paper 1 in `docs/papers`.
