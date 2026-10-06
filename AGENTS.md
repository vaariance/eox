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
