# COX calculation engine and Solana program

COX makes crypto assets' performance relative to the CRYPTO benchmark tradeable. The benchmark uses equal-weight price growth across its configured assets. An asset can rise in USD while underperforming CRYPTO; its relative reference captures that difference.

This workspace implements `COX/TRANSFER/MVP-0` for Solana devnet with six-decimal classic SPL test collateral. Positions are accounting claims on a closed collateral pool, rather than wallet holdings of the underlying crypto assets. The mechanism uses no leverage or externally manufactured payouts.

## Components

| Path | Purpose |
| --- | --- |
| `crates/math` | Checked reference, revaluation, request and custody arithmetic |
| `crates/cli` | Strict JSON command-line interface to the calculation engine |
| `programs/cox` | Anchor 0.31.1 program, accounts and financial instructions |
| `crates/program-tests` | Compiled SBF lifecycle and SPL custody tests |
| `idl/cox.json` | Generated instruction and account interface |
| `fixtures` | Canonical byte, hash, arithmetic and account examples |
| `deploy` | Deployment configuration, recorded release and signer allowlist |

Start with the [mechanism specification](SPEC.md), [TypeScript client](../cox-client/README.md), [deployment guide](deploy/README.md) or [publisher](../../apps/cox-publisher/README.md). The [deployment record](deploy/deployed-devnet.json) identifies a verified program release; it is not a live service health check.

## Trading lifecycle

A deposit reserves collateral; a switch or redemption reserves position units. Requests first become eligible at a future publication and cannot execute against the reference available when they were created. Acceptance fixes the batch's execution values. Evaluation, aggregate safety checks and execution then proceed across transactions using persistent cursors.

Finalization commits receipts, position changes and payables together. Staged credits cannot be spent. Future requests and withdrawals of previously committed payables may continue during processing. Expiry is assessed against the accepted batch, rather than the eventual processing time. There is no fill deadline and no new publication while accepted work remains unfinished. Cancellation, expiry, refunds and withdrawals have separate instructions.

Only publishing requires the runtime authority. Processing instructions are permissionless. Admin and upgrade authority are separate from runtime publishing.

One reusable batch and one latest-publication account bound recurring account rent per pool. Their schema version is 2, and their addresses do not include a batch or publication number. The publisher archives finalized publication bytes before overwrite; historical consumers must use that archive rather than derive a separate account for each sequence.

## Arithmetic and custody

Prices use scale `10^8`; reference values and unit quanta use scale `10^12`. Collateral amounts are base units of the six-decimal mint. All arithmetic uses exact integers.

Reference calculation rounds each price-growth factor, its equal-weight mean, the chained benchmark and origin-normalized relative references in the specified order. Rounding is nearest with halves away from zero. CRYPTO's transfer factor is `10^12`. Missed minutes link directly to the previous accepted publication and freeze rebalancing under the specified policy.

Existing class backing is revalued with `floor(C × V × h / sum(V × h))`. Rational unit prices are fixed before requests execute. Mint and redemption outputs round down; switches redeem and mint at those same fixed prices. An empty class bootstraps at one collateral base unit per whole claim unit: one base unit mints `10^12` quanta. This denomination is not one whole collateral token per position unit.

The ledger maintains:

```text
vault = active backing + pending deposits + payable collateral + residual
```

Residual includes rounding dust and unsolicited surplus tokens and does not participate in returns. Deposits awaiting refund remain pending until transferred out; payables no longer participate in performance. A collateral shortfall stops processing. Zero-value classes reject entry but permit zero-proceeds burns with a zero minimum.

## Numerical limits

Stored backing uses `u64`, units use `u128`, and calculation intermediates use checked `i128`. Input and resulting classes must satisfy `units × backing ≤ i128::MAX` and `total_active² × 10^12 ≤ i128::MAX`.

The program limits active backing plus pending deposits to `10^11` collateral base units and each class to `10^24` unit quanta. If aggregate incoming requests exceed a class's unit capacity, all incoming requests to that class are rejected for the batch. Arithmetic checks still apply within these limits. An unsafe reference or revaluation rejects the snapshot before acceptance; precision is never silently reduced.

## Build and test

Run from the repository root with Rust 1.90, Cargo, rustfmt and Clippy:

```sh
cargo test --manifest-path packages/cox/Cargo.toml --workspace --locked
cargo clippy --manifest-path packages/cox/Cargo.toml --workspace --all-targets --locked -- -D warnings
cargo fmt --manifest-path packages/cox/Cargo.toml --all --check
cargo run --manifest-path packages/cox/Cargo.toml --locked -p cox-cli -- verify-vectors packages/cox/fixtures/vectors.json
cargo run --manifest-path packages/cox/Cargo.toml --locked -p cox-cli -- publication packages/cox/fixtures/publication-input.json
```

The compiled-program suite is a separate Cargo workspace; follow its [test guide](crates/program-tests/README.md). Host-side math tests alone do not exercise on-chain custody. Recorded [math verification](results/verification.json) and [runtime measurements](results/program-runtime.json) describe the source and environment recorded in each artifact.

## CLI

`reference`, `revalue`, `batch`, `publication` and `verify-vectors` read a file argument or standard input. Amounts, units, prices and fixed-point results are canonical nonnegative decimal strings. Class indices, enum codes and batch metadata are JSON integers. Unknown fields, numeric monetary amounts, zero prices and overflow fail with a nonzero exit code and an error on standard error.

`publication` composes reference calculation, revaluation, fixed-value request execution and ledger reconciliation. Its supplied input is synthetic. `batch` consumes already admitted and reserved requests with a bound publication batch ID; wallet authorization and eligibility are enforced by the Solana program.

## Test scope

The finite simulation suite checks conservation, vector parity, round trips, mass exits, split requests and numerical boundaries. Compiled tests additionally exercise account validation, token transfers and execution recovery. Local packet-size and compute measurements do not establish network throughput or promise fills within one minute.

Repeated tiny operations can move backing into residual even when splitting provides no user-output advantage. The test mechanism does not establish a production minimum-order or residual policy, authenticate market prices by itself, or constitute a production security audit.
