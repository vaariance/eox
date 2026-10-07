# Synthetic fixture scenarios

These are deterministic research inputs, not observations of real economies.
Country labels are illustrative. Every supplied artifact digest verifies against
`artifact.txt`, which explicitly identifies itself as synthetic.

- `baseline.json`: US, JP, GB, NG; four indicator slots each; all indices 100.
- `us-improves.json`: US first indicator increases; fixed baseline remains 100.
- `confidence-decay.json`: identical economics, evaluated 60 days later.
- `contested.json`: one unsuccessful challenge retained against US evidence.

Slots exercise identity, difference, fractional change, and target normalization.
Every country has a unique series per slot. All quality ratings begin at 10,000
basis points. Source authority is fixed in each rule.

Run `eox-oracle preview <fixture.json>` after building the Rust workspace. The
`fixture` command emits the baseline fixture. It does not write files.

The clock 1,800,000,000 is synthetic and fixed for reproducibility. A devnet runner
must explicitly rebase fixture timestamps to a chosen current chain clock before
committing them, preserving the declared offsets. It must not submit future
publication times or pretend these fixture timestamps came from real sources.

JSON integer fields use the Rust fixed-point representation. Integrations must
preserve integer precision; the valid Rust range exceeds JavaScript's safe-number
range. The fixture numbers themselves are within that range.
