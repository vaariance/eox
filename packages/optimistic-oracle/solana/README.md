# solana (Godwin)

Anchor workspace with `eox_settlement_oracle`, the Solana side of the EOX optimistic oracle.

Results are challenged and settled on the EVM side, through UMA's Optimistic Oracle V3 and
the `EoxAssertionAdapter` in `../evm`. This program only receives each settled result over
Wormhole and stores it where Solana programs, such as the market, can read it.

| Instruction | Who | What |
|---|---|---|
| `initialize` | program upgrade authority, once | Sets the Wormhole core bridge program, the adapter's Wormhole chain ID and its address |
| `open_epoch` | authority | Opens a year and pins its methodology image ID (open the same epoch on the adapter) |
| `receive_result` | anyone | Records the result from a posted VAA, once per epoch |
| `void_epoch` | anyone | Voids an epoch with no result 35 days after its cutoff |

`receive_result` accepts a result only if:

1. the VAA account is owned by the configured Wormhole core bridge and starts with `vaa`,
   meaning the guardians' signatures were verified when it was posted;
2. it was emitted by the adapter on the configured chain;
3. the payload is exactly the adapter's 167-byte result for this epoch's year, using this
   epoch's methodology;
4. it arrives between the cutoff (31 July of the following year) and the deadline.

The payload layout is pinned on both sides by the same golden bytes
(`test_golden_payload` in the adapter, `GOLDEN_PAYLOAD` here).

## Build and test

Requires Anchor 1.2 and the Solana CLI. Tests run in LiteSVM, which needs the SBPF v0 build:

```bash
cargo build-sbf --arch v0 --manifest-path programs/eox_settlement_oracle/Cargo.toml
cargo test
```
