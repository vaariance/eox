# optimistic-oracle (Godwin)

Makes each yearly EOX result final. Results are challenged and settled through UMA's
Optimistic Oracle V3 on an EVM chain (Base), then relayed over Wormhole to Solana, where
the EOX market reads them.

The oracle never computes a result. It takes the claim the methodology produces (evidence
root, methodology image ID, output hash, resolution URI hash) and settles whether it is true.

```
claim (from the methodology)
  │
  ▼
evm/     EoxAssertionAdapter ── assertTruth ──▶ UMA Optimistic Oracle V3
           ▲                                     │ 72h liveness, dispute → UMA vote
           └──── assertionResolvedCallback ◀─────┘
           │ publishResult
           ▼
         Wormhole (guardians sign a VAA)
           │ post the VAA to Solana's core bridge
           ▼
solana/  eox_settlement_oracle.receive_result ──▶ epoch.result, read by the market
```

| Folder | What | Test |
|---|---|---|
| `evm/` | Foundry: the adapter that opens epochs, asserts claims to UMA and publishes results | `forge test` |
| `solana/` | Anchor: the program that records a verified result per epoch, or voids it | `cargo build-sbf --arch v0 --manifest-path programs/eox_settlement_oracle/Cargo.toml && cargo test` |
| `sdk/` | TypeScript (`@eox/optimistic-oracle`): payload codec, EVM calls (viem), Solana instructions and decoders (Kit) | `pnpm --filter @eox/optimistic-oracle test` |

## A year, step by step

1. **Open** the epoch on both sides with the same methodology image ID: `openEvmEpoch`
   (adapter owner) and `openEpochInstruction` (program authority).
2. **Assert.** From the cutoff, 31 July of the following year, until 21 days after it,
   anyone can `assertResult` with the claim and the epoch's bond. One assertion at a time.
3. **Challenge.** Anyone can dispute on UMA within 72 hours. A disputed assertion goes to
   UMA's vote. A false one is rejected and a new assertion can be made.
4. **Settle.** A true assertion settles the epoch on the adapter.
5. **Relay.** Anyone calls `publishResult`. Once the guardians sign, post the VAA to
   Solana's Wormhole core bridge with Wormhole's SDK, then send `receiveResultInstruction`.
6. **Deadline.** If no result reaches Solana within 35 days of the cutoff, anyone can
   `voidEpochInstruction`.

The three parts agree byte for byte on the 167-byte result payload, the Anchor
discriminators, the program addresses and the account layouts. Each side pins the same
values in its tests, so a change on one side fails a test on the other.

## Setup

```bash
git submodule update --init --recursive   # forge-std and OpenZeppelin for evm/
pnpm install
cd evm && forge build && cd ..            # also needed by the SDK's EVM tests and gen:abi
cd solana && cargo build-sbf --arch v0 --manifest-path programs/eox_settlement_oracle/Cargo.toml
```

The SDK's Anvil and LiteSVM tests are skipped when `anvil`, the Foundry build or the
compiled program is missing. After changing the adapter, run `pnpm --filter
@eox/optimistic-oracle gen:abi` to refresh `sdk/src/adapter-abi.ts`.

## Before mainnet

- Pick the bond currency and size, and UMA's minimum bond for it on the chosen chain.
- Deploy the adapter, then initialize the program with Wormhole's Base chain ID (30) and the
  adapter's address (`evmEmitterAddress`).
- Move the adapter's ownership and the program's upgrade authority to multisigs.
- Get both audited.
