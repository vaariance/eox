# EOX Resolution Plan

Scope: a deterministic oracle with two parts.

- **The engine** (`eox-engine`, `packages/apps/methodology`). Given a snapshot of evidence,
  it always produces the same scores, evidence root and output hash, so anyone can re-run
  it and check a result.
- **The settlement program** (`eox_settlement_oracle`, `packages/apps/onchain`). It
  commits the engine's hashes on-chain, lets anyone challenge them with a bond, and
  records the final result.

> Rebuilt on 2026-10-06. The original plan lived in the gitignored `docs/` folder and was
> lost. On 2026-10-06 the scope was narrowed to the engine and the settlement program. The
> arbiter panel program and the oracle bots were removed, and remain in git history at
> `b6f85a6`.

## 1. What the engine does

```
snapshot (observations as of the cutoff)
        │
        ▼
 eox-engine ── evidence root   (Merkle root over canonical observations)
            ── output bundle   (scores, world benchmark, attribution)
            ── output hash     (hash of the canonical bundle)
```

Rules it enforces:
- No I/O, no clocks, no randomness. The same input always produces the same bytes, in any
  order of observations.
- Fixed-point decimal math (`Wad`) with strict parsing and round-half-even. No floats.
- Snapshot `as_of` must be exactly the cutoff, **31 July 00:00 UTC** of the year after the
  epoch.
- Every observation must be known by the cutoff and cover the epoch year (1 Jan–31 Dec).
- Countries and indicators outside the methodology version are rejected, as are duplicates.
- An indicator needs 2 reporting countries, and a country needs at least 3 scoreable
  indicators. Exclusions cascade until the set stops shrinking.
- Each country is benchmarked against WORLD *excluding itself*. Relative scores sum to zero.
- Leaves are `sha256(0x00 || canonical observation)` and nodes are
  `sha256(0x01 || left || right)`.
- The bundle commits to the evidence root, the methodology image ID and the excluded
  countries.

Public API: `evaluate_methodology`, `hash_output_bundle`, `canonicalize_output_bundle`,
`build_snapshot`, `get_methodology_config`, `merkle::{compute_evidence_root,
hash_observation, canonicalize_observation, MerkleTree}`, `Wad`.

## 1b. How a year settles on-chain

1. Epoch `Y`'s evidence cutoff is 31 July `Y+1`. An approved proposer posts the claim
   (evidence root, methodology image ID, output hash, resolution URI hash) with a bond
   within 48 h.
2. Anyone may challenge within 72 h with the same bond and stated grounds.
   `WrongObservation` is checked on-chain with a Merkle proof.
3. With no challenge, `settle` commits the claim as `epoch.result`.
4. A first challenge resets the epoch. A new claim at 2× the bond has 48 h.
5. A second challenge escalates it. The arbiter key from `initialize` has 14 days to call
   `resolve_arbitration`. The panel program is removed, so that key is a plain signer
   for now.
6. Any missed deadline voids the epoch and refunds every bond. The winner gets their bond
   back plus 90% of the loser's, and 10% is burned. Each party `withdraw`s their own.

Nothing calls the program on its own. Proposals, challenges and the `settle`, `void` and
`burn` calls have to be sent by someone. That was the removed bots' job, so it's done by
hand for now.

## 2. Status

| Item | Status |
|---|---|
| Methodology v0.1 (8 indicators, universe CHN/DEU/GHA/NGA/USA) | ✅ Done |
| Fixed-point math, canonical encoding, Merkle tree, output hash | ✅ Done |
| Cutoff and epoch-year checks, per-country indicator counts | ✅ Done |
| Tests | ✅ 33 pass (`cargo test -p eox-engine`): 27 engine, 6 Merkle |
| CLI to run the engine on a snapshot file | ⬜ Removed with `eox-oracle`. The engine is a library only |
| Methodology matching the ingested data | ⬜ See gap 1 |
| Settlement program | ✅ Restored. 13 unit tests pass natively. 63 LiteSVM tests need `anchor build --arch v0` (not run here) |
| Arbiter for escalated disputes | ⬜ Panel program removed. Pick a signer: multisig, or restore the panel |

## 3. Known gaps

1. **v0.1 doesn't match what ingestion collects.** Ingestion on `main` covers 30
   OECD/BIS countries and the IDs `container_throughput`,
   `residential_property_price_real`, `gdp_real_volume`, `cpi_core_yoy`,
   `unemployment_rate` and `policy_rate`. v0.1 expects CHN/DEU/GHA/NGA/USA and
   `nighttime_lights`, `ndvi_crop_health`, `overnight_lending_rates`, `pmi`,
   `gdp_real_growth_yoy`, `cpi_headline_yoy`, `unemployment_rate` and
   `fiscal_deficit_gdp`. Until a version matches, real data can't be scored. Mocked data
   in the v0.1 shape works.
2. **The observation shape is behind the evidence store.** On `main`, the store adds
   `raw_value`, `recorded_at` and coverage fields. The engine's `Observation`, and so its
   canonical leaf encoding, doesn't have them.
3. **There's no cross-machine reproducibility check.** Tests prove determinism inside one
   run, but nothing pins a known root and hash for a fixed snapshot.

## 4. Next steps

1. **Golden test.** Commit a mocked snapshot fixture and assert its exact evidence root and
   output hash. Any change to encoding or math then fails loudly, on every machine.
2. **Small CLI** (`eox-engine run --snapshot file.json --epoch 2025 --image-id …`), so a
   snapshot can be scored and checked without writing Rust.
3. **Decide the canonical observation fields** after the evidence-store changes on `main`:
   which of `raw_value`, `recorded_at` and coverage go into the leaf. This changes every
   root, so do it before any result is published.
4. **Decide the cutoff clock:** `known_at` (the source's claim) or `recorded_at`
   (DB-stamped). The engine currently checks `known_at`.
5. **Methodology v0.2** for the ingested indicators and the 30 pilot countries: weights,
   polarity (higher is better or worse) and the minimum per country. Keep v0.1 so its
   hashes stay reproducible.

## 5. Open decisions

| Decision | Options | Owner |
|---|---|---|
| Cutoff clock | `known_at` / `recorded_at` | Joel + Godwin |
| Canonical leaf fields | current 11 fields / add `raw_value`, `recorded_at`, coverage | Godwin |
| v0.2 indicators, weights, polarity, universe | from ingestion's 6 | Godwin + Peter |
| Which vintage counts for revised data | first release / fixed window / final vintage | team |

## 6. Run it

```bash
cargo test -p eox-engine
cd packages/apps/onchain && anchor build --arch v0 && cargo test
```

Keep this file up to date as steps land and decisions are made.
