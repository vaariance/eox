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
