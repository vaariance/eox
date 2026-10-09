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
