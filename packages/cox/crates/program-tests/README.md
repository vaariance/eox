# Compiled COX program tests

This crate runs the compiled COX SBF program in LiteSVM. It exercises classic SPL Token instructions for mint creation, issuance, escrow, refunds and withdrawals with six-decimal test collateral. It does not substitute a host processor for the COX program.

## Run

First build the program using the [deployment toolchain](../../deploy/README.md). From the repository root:

```sh
COX_PROGRAM_SO="$PWD/packages/cox/target/deploy/cox.so" \
  cargo test --locked --manifest-path packages/cox/crates/program-tests/Cargo.toml
```

`COX_PROGRAM_SO` accepts an absolute path to the compiled artifact. If omitted, the harness uses `packages/cox/target/deploy/cox.so`. A missing artifact fails the suite rather than skipping it. This crate has a separate Cargo workspace and lockfile; the main COX workspace test command does not run it.

## Coverage

The suite verifies:

- Initial publication, reserved deposit, finalized units, switch, redemption, payable withdrawal and complete exit.
- Vault equality through real transfers; extra vault tokens isolated as residual and collateral shortfall failing closed.
- Wallet ownership, mint/vault substitution, registry upgrade-authority checks, duplicate processing and reservation conflicts.
- Cancellation, one-time refunds and expiry assessed against the accepted batch.
- Execution extending beyond a minute, pause/resume, restart recovery and unchanged accepted execution values.
- Future submissions and committed-payable withdrawals during earlier batch execution, without spending staged credits.
- Failed minimum outputs, aggregate class-capacity rejection, arithmetic rejection and released reservations.
- Missed minutes, snapshot deadlines and thirty-price publication packet/compute usage.
- Reusable batch/publication account rent, batch resets and preserved lazy position balances.

Test signing keys are ephemeral and unrelated to deployed runtime identities.

## Export account fixtures

The thirty-price test can write real decoded account fixtures for the TypeScript client:

```sh
COX_PROGRAM_SO="$PWD/packages/cox/target/deploy/cox.so" \
COX_ACCOUNT_FIXTURES_PATH="$PWD/packages/cox/fixtures/accounts.json" \
  cargo test --locked --manifest-path packages/cox/crates/program-tests/Cargo.toml \
  thirty_price_publication_packet_and_compute_measurement
```

This command intentionally rewrites the fixture. Regenerate it only with the corresponding IDL and program release, then run the client tests.

## Measurement scope

Successful transactions record serialized packet size and consumed compute units. The repository's [runtime measurement artifact](../../results/program-runtime.json) identifies the program hash, requests and measured instructions for a recorded run.

LiteSVM timing measures local simulation, including setup and token operations. It does not establish blockchain throughput, confirmation latency, RPC capacity or a promise that a network batch fills within one minute.
