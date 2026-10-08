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
- **Refs:** `docs/oracle/calibration-proposal.md`; https://docs.google.com/document/d/1jR1YtxBS1-l67OBeQe0LPM9N5irLiwUDIokuqyS3epg/edit.

### 2026-10-07 · Peter (Codex) · Research bindings and confidence assertions

- **Area:** `packages/methodology`, worker integration tests, `docs/oracle`.
- **What:** Added six pilot audit bindings and a named eight-factor assertion compiler. It binds record/payload, assessor, rating rubric, source policy and supporting digests into a canonical manifest and emits the existing worker tuple. Sixteen methodology tests and 29 worker tests cover this integration.
- **Rules for agents:** The compiler checks structure, not assertion truth or assessor authentication. Live adapters must verify referenced artifacts and use the source authority pinned by the configured rule. Audit ratings never become economic weights or confidence by automatic scaling. All six indicators remain under review; no roster or arithmetic changed.
- **Open:** Historical calibration data, numerical rating rubrics, economic parameters and live provider integration. Do not claim the helper is already wired to live evidence.
- **Refs:** `packages/methodology/README.md`, `docs/oracle/geffy-methodology-contract.md`.
