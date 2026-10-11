# COX Solana client

`@cox/client` provides typed account readers, PDA derivation, unsigned instruction builders, read simulations and canonical receipt/state encoders for the COX Solana program. It is a workspace package for Node.js 24 and Anchor 0.31.1.

The client does not sign or broadcast transactions, fetch market prices or recalculate the economic reference. Wallets authorize user transactions; the approved signing service authorizes runtime publication.

## Setup

Install workspace dependencies from the repository root, then validate the package:

```sh
pnpm install --frozen-lockfile
pnpm --filter @cox/client build
pnpm --filter @cox/client test
```

Create an Anchor `Program` with the [generated IDL](../cox/idl/cox.json) and the intended provider, then construct the client helpers:

```ts
import { CoxReader, CoxInstructions, CoxSimulations } from "@cox/client";

const reader = new CoxReader(program);
const instructions = new CoxInstructions(program);
const simulations = new CoxSimulations(program, feePayerPublicKey);
const pool = await reader.pool(0n);
```

Here `program` is the configured Anchor instance and `feePayerPublicKey` identifies an existing account used by unsigned simulations. No private key is needed for a read simulation. Verify the RPC network, program release and pool before preparing transactions; constructing these helpers alone does not pin the network.

The `@cox/client/swap` entry point is tested with a browser bundle and provides the benchmark deposit and redemption flow below.

## Benchmark swaps

`CoxSwapSdk` prepares unsigned transactions for collateral → CRYPTO and CRYPTO → collateral. CRYPTO is the final class, after every asset class. In the 30-asset pool its index is **30**; index **0** is BTC. Read `market().cryptoClass` rather than hard-coding an index.

```ts
import { PublicKey } from "@solana/web3.js";
import { CoxSwapSdk } from "@cox/client/swap";

const swap = new CoxSwapSdk(program, {
  poolId: 1n,
  collateralMint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
});
const market = await swap.market();
```

This configuration selects pool 1 with Circle devnet USDC. The SDK validates the network, mint and sealed methodology. `prepareBuy` reserves collateral for benchmark units; `prepareSell` reserves benchmark units for redemption. Both execute through a future publication. After redemption finalizes, `prepareWithdraw` prepares the separate transfer of committed collateral to the wallet. Quotes are estimates, and the SDK never signs or broadcasts transactions. Moving between CRYPTO and individual asset positions uses the trading instructions separately.

## Integer values

| Value | Representation |
| --- | --- |
| Builder amounts, units and sequence inputs | `bigint` |
| Decoded account and simulation integers | Anchor `BN` |
| USD input prices | Integer at scale `10^8` |
| Reference values and position unit quanta | Integer at scale `10^12` |
| Test collateral | Base units of a six-decimal classic SPL mint |

Serialize large integers as decimal strings in API responses. A relative reference is different from the redeemable backing per position unit. Empty classes mint `10^12` unit quanta for each collateral base unit; do not assume that one collateral token buys one whole position unit.

## Account reads

`CoxReader` reads finalized registry, pool, methodology, position, request, batch and publication accounts. It checks account ownership, schema version, expected addresses, linkage and applicable hashes. Sealed methodology bytes must match their digest, and publication state must match its committed identity and prices.

`position` and `request` return the effective committed state even before a materialization transaction. Staged credits remain unavailable until the pool commits their sequence. Separate RPC reads can cross a publication; an inconsistent newer position fails with `InconsistentRead`. Retry the complete read rather than combining values from different observations.

Account validation does not authenticate price venues or replace independent publication verification. Use the IDL and matching client release together: account layouts and PDA seeds are versioned protocol details.

Each pool has one reusable batch account and one latest-publication account at fixed seeds. Legacy pools and requests use schema 1; migrated pools and new requests use schema 2. Legacy batches and publications use schema 2, and fee-aware batches and publications use schema 3. Readers accept both releases, treating legacy fee fields as zero. `reader.batch(poolId, batchId)` and `reader.publication(poolId, sequence)` check that the requested identity is still retained and fail with `CoxHistoryNotRetained` after it has been overwritten. Historical publications must come from the publisher's archive; there is no per-sequence on-chain history account.

## User transactions

`CoxInstructions` returns `TransactionInstruction` values with account order, signer flags and write flags taken from the IDL. It supports deposit, switch, redeem, cancel, expire, refund and withdraw, plus registry, methodology, pool, publication and processing instructions.

A typical user flow is:

1. Read the pool's current global request nonce and derive the position and request addresses with `addresses(program.programId)`.
2. For a migrated pool, build `depositWithFee`, `switchWithFee` or `redeemWithFee` with exact amounts, net minimum output, inclusive expiry batch and the observed `pool.feeVersion`. Legacy instructions work only while the active fee version is zero.
3. Assemble a transaction, have the wallet sign it and submit it through the application's transaction transport.
4. Track the request through a future publication and batch finalization.
5. Withdraw committed redemption payables or refund a rejected/cancelled deposit when appropriate.

Submission reserves collateral or units. It does not guarantee execution at the current quote. Competing submissions using the same global nonce race; a rejected submission must reload state and rebuild. After an ambiguous network timeout, reconcile the original transaction and request before submitting a new deposit.

Refund and withdrawal are distinct operations. Redemption creates a payable after finalization; it does not immediately transfer tokens to the wallet. Supply the owner's token account for the configured mint, rather than assuming devnet test collateral is genuine USDC.

## Read simulations

`CoxSimulations.reference`, `position` and `quote` execute unsigned versioned transactions with `sigVerify: false` at finalized commitment. Results are accepted only when return data comes from the configured program. Simulation makes no trade and reserves nothing.

`quote` estimates the current committed valuation for legacy or zero-version pools. For migrated pools, use `quoteWithFee` with the observed configuration version; it returns gross collateral value, fee, net redemption proceeds or net minted units, and the configuration version. A future publication fixes the actual execution values, which may differ. Minimum-output and expiry checks remain authoritative on chain.

## Trading fees

Fees are calculated in collateral base units: `min(gross × bps / 10_000, cap)`, rounded down. Either a zero rate or zero cap disables charging. The program limits configuration to 100 bps and 2,000,000 base units ($2 for six-decimal USDC). Fees apply once to successful deposits, switches and redemptions; cancellations, failed requests, refunds and withdrawals carry no trading fee. Network fees are separate.

`CoxSwapSdk.market()` exposes active fee terms and any scheduled change. Quotes include `gross`, `fee`, `netCollateral`, `estimatedOutput` and `feeTerms`; quote amounts remain estimates for a future publication. Pass `quote.feeTerms.version` as `expectedFeeVersion` to `prepareBuy` or `prepareSell` to preserve the reviewed configuration. Prepared transactions are rejected if their fee version changes before signing or on-chain submission. Submitted requests retain their original fee rate and cap.

Request reads expose locked `feeTerms`; `gross` and `fee` become visible when a successful receipt is committed. Staged receipts cannot be treated as completed trades. The vault's committed treasury balance is `pool.fees` and remains separate from user backing, pending deposits, payables and residual.

Admin builders provide `migratePool`, `scheduleFees`, `cancelFees` and `withdrawFees`. The first schedule activates at a future publication; subsequent schedules require at least 24 hours' notice. Activation occurs when a qualifying publication finalizes. Treasury withdrawals must use an admin-owned token account for the pool's collateral mint. These instructions require admin authorization and are outside publisher authority.

Fee-aware receipts and states use `COX/RECEIPTS/V2` and `COX/STATE/V2`. `receiptRoot([], 2)` selects the empty V2 root; nonempty V2 receipts carry `feeTerms`. `State.feeState` selects V2 state encoding. `decodeState` retains V1 compatibility and verifies the V2 fee-policy digest. The original sealed methodology bytes remain immutable.

## Batch processing

The program fixes accepted values, evaluates eligible requests, performs aggregate safety checks, prepares position changes and finalizes. Processing resumes from the persistent phase and cursor after a restart. Safety passes may repeat when a class becomes blocked; cancelled slots remain queue tombstones. Time passing never permits skipping a slot or repricing accepted work.

Only `publish` requires runtime authority; batch-processing instructions are permissionless. The approved service may also pay processing fees. Admin changes, upgrades and user trades require their own authorities.

## Release fixtures

Client tests require the generated IDL and [account fixture](../cox/fixtures/accounts.json). Missing release artifacts fail verification. Regenerate canonical receipt/state vectors with:

```sh
pnpm --filter @cox/client fixtures
```

Regenerate the IDL through Anchor's compiler-backed builder:

```sh
cargo run --locked --manifest-path packages/cox/scripts/idl-builder/Cargo.toml -- "$PWD/packages/cox"
```

To regenerate account fixtures, run the [compiled lifecycle tests](../cox/crates/program-tests/README.md) with `COX_ACCOUNT_FIXTURES_PATH` set to the absolute fixture output path. Source or ABI changes require regeneration and verification of matching artifacts.
