# methodology (Godwin)

Rust crate `eox-engine`. Takes a snapshot of observations taken from
`@eox/evidence-store` and turns them into scores: normalization, weighting,
country scores, the world benchmark and relative performance.

It also builds the Merkle root over the snapshot and hashes the output bundle,
so a claim can be re-checked by anyone who re-runs the engine.

Contract: methodology never changes stored numbers.
It only reads them and computes from them. The crate does no I/O, and the
same snapshot always produces the same bytes.

```bash
cargo test -p eox-engine
```

Requires Rust (stable).
