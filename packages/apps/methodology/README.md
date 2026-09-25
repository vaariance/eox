# @eox/methodology (Godwin)

Reads observations from `@eox/evidence-store` (using `getAsOf`)
and turns them into scores: weighting, normalization, ranking.

Contract: methodology never changes stored numbers.
It only reads them and computes from them.
