# COX methodology — P1 draft

Dependency-free TypeScript targeting Node 24's native type stripping.

```sh
node --test packages/cox-methodology/test/*.test.ts
node packages/cox-methodology/src/fixtures.ts
```

Run from the repository root. Regeneration uses file-relative URLs and is
independent of the working directory. Tests do not regenerate expected files.
`pnpm --filter @cox/methodology test` is equivalent with Node 24 on PATH.

`compileManifest(config)` emits canonical UTF-8 JSON and its SHA-256. The draft
includes the SYSTEM v2.3 roster, equal rational weights, fallback/conversion,
clocks, signer identity, test-only MVP-0 and arithmetic/accounting rule IDs.
A draft has no origin or feed-report digest; a seal requires both. The caller
must verify the feed report, authority key and deployment before activation.
Changing roster or Bybit availability creates a different digest.

`priceBytes` and `snapshotBytes` implement COX/WIRE/V1 from
[the mechanism specification](../cox/SPEC.md). They validate local shape/order,
not venue authenticity or fallback-attempt evidence. `exactUsd` admits exact
e8 prices. `bybitUsd` applies the single named rational conversion.

`vectors.ts` is an executable specification oracle for P1 fixtures. It assumes
valid pre-reserved requests and ledger inputs; it is not a user-facing service
or a replacement for the Rust implementation. It uses BigInt with checked
signed-i128 arithmetic boundaries. P2 must add storage bounds, numerical
envelope analysis and the full adversarial simulation suite. Godwin's monitor
must reimplement the rules independently rather than import this oracle.

No exchange calls, private keys, deployment, SPL transfers or production
collateral are included. The roster remains provisional pending Joel's feed
check. See SPEC §1 for next-publication eligibility, asynchronous execution and the
one-minute operating capacity target. The +55 s bound is for accepting a
snapshot, not finishing trades.
