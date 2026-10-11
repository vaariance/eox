# Compiled COX program verification

This crate loads `COX_PROGRAM_SO` into LiteSVM. It never substitutes a host
processor for the compiled program. Its collateral is a six-decimal classic
SPL mint; mint creation, issuance, custody transfers, refunds and withdrawals
run through the SPL Token program.

Build the COX SBF artifact first. Set `COX_PROGRAM_SO` to its absolute path,
then run `cargo test --manifest-path packages/cox/crates/program-tests/Cargo.toml`.
A missing artifact fails the test rather than silently skipping verification.

The lifecycle cases must cover:

- Initial publication, escrowed deposit, completed units, switch, redemption,
  payable withdrawal and complete exit, with vault equality after each step.
- Wrong owner, wrong mint/vault, duplicate execution/finalization, conflicting
  reservations and spending staged units/payables.
- Cancellation/refund and expiry bound to the accepted batch, even when
  processing resumes after that batch's minute.
- Future submissions and committed-payable withdrawals while earlier work is
  staged, preserved across pause/resume and process restart.
- Failed minimum conditions, aggregate destination-unit capacity rejection,
  unsafe arithmetic rejection and released reservations.
- Extra vault tokens isolated as residual; a vault shortfall fails closed.
- Missed minutes, publication deadlines and admission of thirty prices in one
  transaction.

Successful transactions record their serialized packet size and actual
compute-unit consumption. These measurements describe this test environment;
they do not establish network confirmation throughput or a one-minute fill
promise. Test keys are ephemeral and unrelated to the deployed KMS key.
