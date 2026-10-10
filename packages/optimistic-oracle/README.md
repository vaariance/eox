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

## A year, step by step

1. **Open** the epoch on both sides with the same methodology image ID: `openEpoch`
   (adapter owner) and `open_epoch` (program authority).
2. **Assert.** From the cutoff, 31 July of the following year, until 21 days after it,
   anyone can `assertResult` with the claim and the epoch's bond. One assertion at a time.
3. **Challenge.** Anyone can dispute on UMA within 72 hours. A disputed assertion goes to
   UMA's vote. A false one is rejected and a new assertion can be made.
4. **Settle.** A true assertion settles the epoch on the adapter.
5. **Relay.** Anyone calls `publishResult`. Once the guardians sign, post the VAA to
   Solana's Wormhole core bridge with Wormhole's SDK, then send `receive_result`.
6. **Deadline.** If no result reaches Solana within 35 days of the cutoff, anyone can
   send `void_epoch`.

The two parts agree byte for byte on the 167-byte result payload. Each side pins the same
golden payload in its tests, so a change on one side fails a test on the other. There is no
shared client: each caller writes its own calls from the contract and program interfaces.

## Setup

```bash
git submodule update --init --recursive   # forge-std and OpenZeppelin for evm/
cd evm && forge build && cd ..
cd solana && cargo build-sbf --arch v0 --manifest-path programs/eox_settlement_oracle/Cargo.toml
```

## Deploy the continuous adapter

`EoxContinuousAdapter` is the hourly path of `product.md` section 8: evidence and snapshot
claims go to UMA with one-hour liveness and their outcomes are relayed over Wormhole in the
format of `packages/oracle/PROTOCOL.md`. It is separate from the yearly adapter above.

```bash
cd evm
SOLANA_PROGRAM=0x... REGISTRY=0x... \
  forge script script/DeployContinuousAdapter.s.sol --rpc-url <rpc> --broadcast --account <keystore>
```

Without `--broadcast` the script only simulates the deployment.

| Variable | Meaning | Default |
|---|---|---|
| `SOLANA_PROGRAM` | The `eox-oracle` program address as 32 bytes of hex | required |
| `REGISTRY` | That program's registry account (PDA of seed `registry`) as 32 bytes of hex | required |
| `OOV3` | UMA Optimistic Oracle V3 | Ethereum Sepolia |
| `WORMHOLE` | Wormhole core bridge | Ethereum Sepolia |
| `BOND_CURRENCY` | ERC-20 on UMA's collateral whitelist | Sepolia WETH |
| `OWNER` | Adapter owner, who opens epochs and sets asserters | the deployer |
| `ASSERTER` | Account allowed to assert claims; `0x0000000000000000000000000000000000000000` to skip | dev `uma-asserter` in `deploy/signing/dev-keys.json` |

The destination is fixed at deployment, so deploy one adapter per Solana network and
registry. The asserter is only set when the deployer is the owner; otherwise the owner calls
`setAsserter`. Before the first claim the owner must also call `openEpoch` with the epoch's
methodology manifest, configuration digest and evidence policy.

## Before mainnet

- Pick the bond currency and size, and UMA's minimum bond for it on the chosen chain.
- Deploy the adapter, then initialize the program with Wormhole's Base chain ID (30) and the
  adapter's address (`evmEmitterAddress`).
- Move the adapter's ownership and the program's upgrade authority to multisigs.
- Get both audited.
