# EOX six-indicator methodology compiler

This package compiles explicit, epoch-immutable policy into the continuous oracle's configuration contract. It does not select economic parameters, fetch evidence, assign evidence quality assertions, calculate EOX outputs or replace the Rust mathematical specification.

`compileMethodology(policy)` returns `configuration`, `canonicalManifest` and `manifestDigest`. Country policy identifiers are ISO3; emitted Solana country identifiers are ISO2. Every selected country requires all six indicator policies. There are no omitted-slot or confidence defaults. Configuration integers that cross the i64 boundary use decimal strings, and source/unit/series identities are SHA-256 byte arrays.

```sh
pnpm --filter @eox/methodology methodology compile --policy fixtures/synthetic-policy.json --out /tmp/eox-methodology
pnpm --filter @eox/methodology build
pnpm --filter @eox/methodology test
```

Paths in the command are resolved from the process working directory; when using `pnpm --filter`, use absolute paths or paths relative to this package.

The checked-in policy is **synthetic integration data**. Equal weights, perfect source authority, targets, bounds and freshness windows have no calibrated economic interpretation. In particular, higher property prices or policy rates are not inherently better. A live policy requires explicit rationale and reviewed country-specific parameters. Source authority is pinned per indicator in the compiled configuration; the other seven quality factors remain evidence assertions supported by provenance. Unknown publication times remain rejected by oracle readiness, without fallback to ingestion time.

## Catalogue and periods

The 30-country catalogue pins the current six ingestion contracts: PortWatch container tonnage (daily), BIS real residential property index (quarterly), OECD real GDP in national-currency millions (quarterly), OECD core CPI year-on-year percentage (monthly), OECD unemployment percentage (monthly), and BIS policy-rate percentage (monthly). New Zealand core CPI and unemployment use quarterly periods. These are the supported contracts, not an assertion that an arbitrary future payload has the right frequency. An adapter must reject differing units/frequencies. Database unit tokens are retained exactly.

Core CPI is already year-on-year and uses identity; a second fractional-change operation is rejected. Other transforms and every direction/target are explicit policy choices. Comparison deltas count native periods, not seconds. `periodOrdinal` accepts strict `YYYY-MM-DD`, `YYYY-MM` or `YYYY-Qn`, validates the Gregorian calendar and returns an integer string. Daily ordinals are days since 1970-01-01, monthly ordinals are `12*year + month-1`, and quarterly ordinals are `4*year + quarter-1`. Frequencies must never be mixed within a series. `gdpMillions(raw, UNIT_MULT)` converts declared source units to million-unit decimal values exactly for multipliers 0–6; it rejects precision loss instead of reproducing ingestion rounding. Adapters still need to validate source unit metadata and supply exact raw strings.

## Portable identity and manifest schema

`seriesIdentity(country, indicator)` returns `EOX/SERIES/V1:` followed by compact JSON of `[ISO3, indicator, source, frequency, unit]`. It excludes epoch and methodology version so a policy change cannot reset evidence challenge history. The worker accepts this string as `EvidenceRecord.seriesId`, hashes it once, and compares it with the compiled rule. Source and unit hashes are SHA-256 of the exact UTF-8 catalogue strings.

The manifest digest is SHA-256 of the UTF-8 canonical manifest string, without a trailing newline. The string is compact JSON containing only ordered arrays, strings and safe integers:

```text
["EOX/METHODOLOGY/V1", policyVersion, epochId,
 "fixed-1e6-nearest-ties-away-v1", "equal-country-world-includes-self", multiplier,
 [[ISO3, ISO2,
   [[indicator, source, unit, frequency, seriesIdentity, transform,
     comparisonDelta, normalization, weight, sourceAuthority,
     graceSeconds, zeroSeconds, rationale], ...]], ...]]
```

Countries sort by ASCII ISO3. Indicators follow the exported `INDICATORS` order. A directional normalization is `["directional", scaledLower, scaledUpper, direction]`; target normalization is `["target", scaledTarget, scaledDistance]`. All scaled values, period deltas and seconds are canonical integer strings. Input property ordering, country/indicator permutations and equivalent decimal spellings cannot change the result. Rationale is preserved byte-for-byte. Version-1 binds the existing oracle confidence combination and dispute rules through its versioned domain; future rule changes require a new schema/arithmetic version.

The manifest digest is a **portable policy commitment**, distinct from the program's deployment-bound configuration hash, epoch address and executable image hash. It must not be substituted for any of those identities. The compiler emits no on-chain approval and does not mutate the epoch baseline. Any changed policy requires a newly configured epoch rather than changing rules beneath published snapshots.

## Calibration research

`research/sensitivity.ts` runs hypothetical six-indicator scenarios through the
existing Rust preview executable. Set `EOX_RUST_CLI` to that executable and run
`pnpm --filter @eox/methodology sensitivity OUTPUT_DIRECTORY` with the output
directory relative to this package, or absolute. There is no calculator fallback.
The script records exact input hashes and outputs, and asserts economic and
confidence behavior. It is research tooling with a workspace-relative dependency
on the worker preview adapter; the compiler itself remains independent.

See `docs/oracle/calibration-proposal.md` for the proposed interpretation, test
results, historical-comparison freshness issue, and remaining calibration work.
None of the research parameters constitute an approved live policy.

## Research and confidence assertions

Previous audit identified the reviewed document and the hash of its Markdown export.
`PILOT_AUDIT_BINDINGS` preserves original audit item numbers, six infrastructure
ratings, reported totals and selected-source qualifications for the pilot feeds.
These objects never enter economic weighting or confidence arithmetic.

`compileConfidence(assessment, sourcePolicy)` checks eight named assertions and
emits the worker-compatible `confidenceBps` tuple in the fixed oracle order.
Every factor requires a rating, rationale and supporting artifact digests. The
assessment binds record ID, raw artifact digest, source, assessor identity, rating
rubric digest and source-policy digest. Missing factors fail; a zero rating is
valid and is not interpreted as missing. Source authority must equal the supplied
policy's pinned rating. Supporting digest sets are sorted and deduplicated; the
canonical assertion manifest is domain-separated and SHA-256 hashed.

The live adapter must use the source policy corresponding to its compiled rule,
verify the record and payload binding, retrieve and check referenced artifacts,
and commit the assessment manifest in `EvidenceRecord.manifest` alongside other
provenance. This helper validates structure and consistency. It does not verify
artifact bytes, authenticate the assessor, approve a rating rubric, or prove that
an assertion is true. It does not replace freshness, dispute history or the
existing Rust confidence calculation. The manifest hash is not an on-chain
methodology identity. No live provider is wired in by this helper.

See `docs/oracle/geffy-methodology-contract.md` for the evidence requirements behind
each factor and the remaining economic calibration decisions.
