# COX calculation engine — P2

Devnet test mechanism `COX/TRANSFER/MVP-0`. This workspace has no Solana
program, publisher, venue connection, live collateral or deployment.

`cox-math` implements checked reference, transfer, fixed-value flow and custody
arithmetic. `cox` is its strict JSON CLI. P1's nine arithmetic and three wire
vectors are unchanged and checked against Rust. The P1 TypeScript remains a
separate specification oracle; the production math authority is this Rust
crate. The independent monitor must not import the specification oracle.

## Run

Rust 1.90 with Cargo, rustfmt and Clippy:

```sh
cargo test --manifest-path packages/cox/Cargo.toml --workspace --locked
cargo clippy --manifest-path packages/cox/Cargo.toml --workspace --all-targets --locked -- -D warnings
cargo fmt --manifest-path packages/cox/Cargo.toml --all --check
cargo run --manifest-path packages/cox/Cargo.toml --locked -p cox-cli -- verify-vectors packages/cox/fixtures/vectors.json
cargo run --manifest-path packages/cox/Cargo.toml --locked -p cox-cli -- publication packages/cox/fixtures/publication-input.json
```

The container alternative mounts only this workspace. Pin/use the recorded
Rust image digest in `results/verification.json` for the tested environment:

```sh
docker run --rm -v "$PWD/packages/cox:/work" -w /work rust:1.90 cargo test --workspace --locked
```

`reference`, `revalue`, `batch`, `publication` and `verify-vectors` read a file
argument or stdin. Amounts, units, prices and fixed-point results are canonical
nonnegative decimal strings. Class indices, enum codes and batch metadata are
JSON integers, matching P1. Unknown fields, numeric monetary values, zero
prices and overflows are rejected. Errors go to stderr and return nonzero;
there is no fallback price or partial successful result.

`publication` composes reference → revaluation → fixed-value batch → reconciled
ledger. Its fixture is synthetic, with two assets and an empty CRYPTO class.
`batch` consumes already admitted/reserved requests and a **bound publication
batch ID**, never eventual fill time. It does not assign requests to cutoffs or
validate wallets; P3 owns these checks. No hard fill deadline is introduced.

## Rules and tests

Reference operation order matches `packages/cox-methodology/src/vectors.ts`:
round each price growth to 10^12; round their equal-weight mean; chain benchmark;
round origin-normalized price and benchmark; calculate the relative reference;
calculate relative growth factors. Every round is nearest with half away from
zero. CRYPTO's transfer factor is 10^12. Missing minutes freeze rebalancing and
link directly to the previous accepted publication.

Revalue existing classes using floor(C × V × h / sum(V × h)), with unallocated
integer dust moved to pool residual. Freeze rational unit prices before flows.
Mint/redemption outputs floor; switches redeem then mint at those fixed prices.
Aggregate accepted unit changes, floor each final class's backing, and move
remaining flow dust to residual. Zero-value classes reject entry but permit
zero-proceeds burns with minimum zero. Empty classes bootstrap at one base
collateral unit per whole claim unit. Residual never participates in returns.

The pure functions never mutate their inputs. Reservations are checked across
the full batch before results; duplicate request identities fail. Ledger methods
assert vault = active + pending + payable + residual before and after every
transition. Refunded deposits remain pending until actually paid; payables stop
participating in performance. Request rejection is distinct from fatal invalid
input or arithmetic failure. Ledger result methods are for trusted results
computed by this engine, not externally supplied balance changes.

See [simulation methods](research/simulation-methods.md) and
[verification results](results/verification.json) for finite test coverage.
The tests do not certify production economics, oracle truth, throughput or all
adversarial strategies. P3 must enforce ownership, lifecycle/replay protection,
fixed-price execution across transactions and atomic state changes.

## Arithmetic admission and limitations

Backing is u64, units u128, but calculation intermediates are checked i128.
Input and resulting classes must satisfy `units × backing ≤ i128::MAX`, and
`total_active² × 10^12 ≤ i128::MAX`. These guards ensure a valid state supports
a full redemption and a subsequent unchanged-price revaluation; they prevent
an accepted oversized entry from immediately trapping its own units. Extreme
future price changes can still overflow and reject the entire proposed update.
No precision is reduced to conceal this failure. P3 must enforce a conservative
admission budget before binding a batch and treat unsupported arithmetic as a
whole-transition failure, not a partially applied financial result.

A sufficient example envelope for intermediates (not a production deposit cap):
active and accepted flow totals ≤10^11 base units, each final class's units
≤10^24, growth/relative factors ≤1000×, origin price ratio ≤10^6, and benchmark
stored value ≤10^20. Inputs/results still undergo exact runtime checks.
Tests cover a 10^11-base-unit entry/full exit and explicit rejection beyond
supported products. The denomination is collateral **base units**, not dollars.

Repeated tiny operations can move remaining holders' backing into residual.
Conservation and no user output advantage from splitting do not imply economic
neutrality or protection from dust griefing. The MVP labels and zero-fee test
scope remain essential; production residual and minimum-order policy remain open.

## EOX deletion boundary

[Deletion audit](research/deletion-audit.md) records Peter's candidates. Product
section 8 step 10 places those deletions after P3, when reusable contract and
publisher patterns have replacements. Current Joel/Godwin imports still need
them. No old EOX component is called by this COX math workspace. No EOX code or
archived evidence was deleted as part of P2.
