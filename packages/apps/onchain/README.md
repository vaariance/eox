# onchain (Godwin)

Anchor workspace with the two Solana programs that make EOX results final.

| Program | Purpose |
|---|---|
| `eox_settlement_oracle` | Yearly epochs: propose a result with a bond, challenge it, settle, void, withdraw |
| `eox_arbiter` | Three bonded panel members who rule on a result that has been challenged twice |

## How a year settles

1. The evidence cutoff is 31 July of the following year. Whatever is known then is final.
2. Within 48 hours an approved proposer posts a claim and locks a bond. The claim holds
   hashes only: the evidence root, the methodology image ID and the output hash.
3. Anyone can challenge within 72 hours by locking the same bond. With no challenge, the
   claim settles.
4. The first challenge throws the claim out. A new claim has 48 hours, at twice the bond.
5. A second challenge sends it to the panel, which has 14 days. Two matching votes decide.
6. Any missed deadline voids the epoch and refunds every bond.

The winner gets their bond back plus 90% of the loser's. The other 10% is burned. Nobody is
paid automatically: the program records what each party is owed and each party withdraws,
so a frozen USDC account cannot block anyone else's payout.

A challenge must say what is wrong. `WrongObservation` names one observation and carries a
Merkle proof that it is in the claim's evidence, checked on-chain. `MissingObservation` and
`Computation` are judged by the panel. `Computation` goes away once the zk proof layer
proves the engine's arithmetic.

## Why we built our own oracle instead of using UMA

The mechanism is the same as UMA's optimistic oracle: assume a result is right unless
someone puts money on it being wrong. We wrote it from scratch for these reasons.

- **UMA does not run on Solana.** Its oracle is deployed on EVM chains. Using it from
  Solana would mean sending every claim and dispute across a bridge, which adds a bridge's
  risk and delay to every settlement.
- **UMA settles disputes by token vote.** Unresolved disputes go to UMA token holders, who
  vote on what they believe and do not re-run anything. Large holders can swing the result.
  EOX results are deterministic: the same snapshot always produces the same bytes. So the
  only honest question in a dispute is whether the evidence matches the designated official
  source, and a vote adds nothing except a way to attack the result. Our rule is "prove,
  don't vote".
- **UMA would not check our evidence.** To UMA a claim is opaque bytes. The parts that keep
  disputes about evidence are ours either way: the on-chain Merkle check that a disputed
  observation is really in the claim, the methodology image ID pinned per epoch, the
  epoch deadlines, and pull payments.
- **It would have saved little.** UMA's newer oracle lets you swap the token vote for your
  own arbiter, but then it only supplies the propose, challenge and bond bookkeeping. That is
  a small part of these programs. The engine, the evidence pipeline, the proof layer and the
  market are needed whichever oracle settles the result.

## Build and test

Requires Anchor 1.2 and the Solana CLI. Tests run in LiteSVM, which needs the SBPF v0 build:

```bash
anchor build --arch v0
cargo test
```

Only the program's upgrade authority can run the one-time setup (`initialize`,
`initialize_panel`).
