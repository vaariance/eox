# EOX deterministic mathematics

All values are signed fixed-point integers at scale 1,000,000. `Rule` and
`Evidence` are Borsh 0.10 structures shared with the Anchor program. Serde JSON
is a tooling boundary, not the commitment format. JSON consumers must preserve
64-bit integer precision; do not pass arbitrary source values through JavaScript
`number`.

`validate_slot` verifies the rule's immutable series/source/unit, comparison
period delta, publication time and quality policy before calculation. `country`
and `world` bound the dimensions to 32 indicators and 30 countries.

Arithmetic order:

1. Transform: round the fractional-change division; difference is exact.
2. Normalization: round the directional or target division, subtract its offset,
   apply direction, then clamp to [-1,1]. Equality at either endpoint is marked
   saturated.
3. Country: round the weighted normalized mean, then multiply by 50 and add 100.
4. WORLD: round the equal-weight mean of the country states.
5. Confidence: multiply eight quality factors in their declared order, rounding
   each product; multiply freshness, then contestation, rounding each product.
   Country and WORLD confidence round their weighted/equal means.
6. Reference: form the cross-product numerator and denominator; round the ratio,
   relative change, and amplified reference independently. Never amplify an
   already-rounded relative change.

Every division uses nearest rounding with ties away from zero. Arithmetic uses
bounded inputs and i128 intermediates; narrowing is checked. Country state bounds
make reference cross-products safe. Decimal adaptation rejects precision loss.

`digest(domain, value)` hashes `EOX/ORACLE/V1\0`, a little-endian u32 UTF-8 domain
length, the domain bytes, and Borsh bytes with SHA-256. `artifact_digest` is raw
SHA-256 of the fetched artifact. These are deliberately different hash domains.

The preview includes a digest of its complete input, not a Solana pre-commitment.
Only the program binds deployment identity, predecessor and snapshot lifecycle.
Confidence ratings remain asserted evidence: recomputing them does not establish
the truth of the ratings. Pending or successful challenge acceptance is enforced
by the program; this library can also calculate provisional pending confidence.

Evidence history identity hashes the Borsh tuple `(series_id, artifact_digest,
unit, source, value, published_at, period, quality)` under domain `evidence`.
Provider record ID, source-claimed known time, and recorded time are excluded so
transport metadata cannot reset challenge history. The full Evidence is still
bound by the snapshot commitment. Changes to actual asserted source content or
quality produce a distinct claim that must pass a new proposal window.

Full Evidence also includes `metadata_digest`, the canonical `evidence-metadata`
digest of `Metadata`: country, indicator, revision ID, manifest, optional
superseded record ID, and optional comparison record ID. All strings are Borsh
length-prefixed UTF-8 and optional strings use the Borsh discriminant. This binds
the source metadata without making transport identifiers reset source-history
identity. `known_at` is nullable and never substitutes for publication time.
