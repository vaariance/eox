# COX Solana client

`@cox/client` contains typed account readers, PDA derivation, unsigned
instruction builders, unsigned read simulations and canonical receipt/state
encoders. It does not sign, broadcast, fetch exchange prices or recalculate
the economic reference. Use the compiled release IDL in
`packages/cox/idl/cox.json`; the draft P1 account table is superseded by the
P3 appendix where explicitly noted.

Construct an Anchor `Program` with that IDL and the intended devnet provider.
Pass it to `CoxReader`, `CoxInstructions` or `CoxSimulations`. All amount inputs
to builders are `bigint`; decoded on-chain integer fields are Anchor `BN`.
Keep these as exact integers or decimal strings when building API responses.
The reference scale is 10^12 and collateral has six decimals. A reference is
different from redeemable backing per unit.

`CoxReader` fetches finalized accounts and checks ownership, schema version,
PDA/linkage and publication hashes. `position` and `request` return the
effective committed view even before a materialization transaction. Staged
credits remain hidden until their sequence is globally committed. Sequential
RPC reads can cross a publication; an inconsistent newer position is rejected
and the caller should retry the complete read. Readers do not authenticate
venue truth, prove the feed report or replace the independent monitor.

`CoxInstructions` supplies every actual instruction, using the generated
IDL's exact account order and signer/write flags. Callers supply the current
request nonce and corresponding position/request addresses. Competing
submissions that used the same nonce must reload after one succeeds. Builders
return `TransactionInstruction` only; the wallet or approved service handles
the appropriate signature and submission. `publish` accepts equal runtime
and payer public keys. The thirty-price transaction measures 1,122 bytes when
runtime pays and 1,218 bytes with a separate payer, both within 1,232 bytes.

Read simulations use an unsigned versioned transaction with `sigVerify:false`
and validate the return-data program ID. The supplied fee-payer public key
needs to identify an existing Solana account but its private key is never
requested. `quote` estimates current committed class valuation; the next
publication's final execution value may differ. A simulation makes no trade.

The program fixes accepted batch values, evaluates all eligible requests,
checks aggregate safety, prepares position deltas and finalizes. The worker
reads each persistent cursor and phase rather than starting again after a
restart. Cranks are permissionless; only `publish` uses runtime authority.
Safety passes can repeat when a class becomes blocked. A cancelled slot stays
in the queue as a tombstone. Neither a minute passing nor a retry permits
skipping a slot or repricing accepted work.

Run `pnpm --filter @cox/client build` and `pnpm --filter @cox/client test`.
The client tests require generated IDL and the account fixture exported by
the compiled-program lifecycle suite; they intentionally fail when release
artifacts are missing. Wire vectors are regenerated with
`pnpm --filter @cox/client fixtures` and verified against exact checked bytes.
`packages/cox/INTEGRATION.md` explains the archive encoding correction,
monitor handoff and retained legacy dependencies.

The standalone `packages/cox/scripts/idl-builder` uses Anchor's official
compiler-backed IDL builder, not a source-code parser. Its documentation lint
is skipped because the repository forbids source comments; the unchecked
upgradeable program account still has executable, exact-address and exact
loader-owner constraints, with program-data and upgrade-authority checks.
This option does not disable on-chain account validation.

Regenerate the IDL from the repository root with:

```sh
cargo run --locked --manifest-path packages/cox/scripts/idl-builder/Cargo.toml -- "$PWD/packages/cox"
```

Generate the real account fixtures by running the compiled lifecycle suite
with `COX_ACCOUNT_FIXTURES_PATH` pointing to the absolute
`packages/cox/fixtures/accounts.json` path. Source or IDL changes require
regeneration and re-verification of those release artifacts.
