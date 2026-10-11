# COX

Crypto Outlook Index: trade crypto assets' performance relative to the CRYPTO
benchmark. This monorepo contains the calculation engine, Solana program,
price archive, publisher, API, monitor and web app. See [product.md](product.md)
for scope and ownership and [SYSTEM.md](SYSTEM.md) for the engineering contract.

## Setup

Requires Node.js 24+, pnpm, Docker for the database, and Rust 1.90 with Cargo,
rustfmt and Clippy for the COX engine and program tests.

```sh
pnpm install
pnpm db:up
pnpm db:migrate
```

## Commands from the repository root

| Command | Purpose |
| --- | --- |
| `pnpm cox:check` | Rust formatting/Clippy and client/publisher type checks |
| `pnpm cox:test` | Methodology, Rust, client, publisher and compiled-program tests |
| `pnpm cox:methodology:test` | P1 methodology and encoding tests |
| `pnpm cox:methodology:fixtures` | Regenerate methodology fixtures; review resulting changes |
| `pnpm cox:math verify-vectors packages/cox/fixtures/vectors.json` | Run the Rust calculation CLI |
| `pnpm cox:math:test` | Rust workspace tests |
| `pnpm cox:client:test` | Account readers, instruction builders and wire tests |
| `pnpm cox:publisher:test` | Publisher scheduling, archive and recovery tests |
| `pnpm cox:publisher --once` | Run one publisher tick; supplied configuration is disabled |
| `pnpm cox:archiver` | Run the price archiver; requires its database configuration |
| `pnpm cox:feed-check 7` | Read the seven-day feed report from the configured database |
| `pnpm cox:program:build --solana-bin PATH --platform-tools PATH` | Build the Solana artifact with the reviewed toolchain |
| `pnpm cox:program:test` | Run compiled SBF lifecycle and real SPL custody tests |
| `pnpm cox:deploy --solana-bin PATH --platform-tools PATH --approved-commit SHA` | Deploy the approved program build to devnet |
| `pnpm test` | Run all pnpm workspace package tests |

`cox:test` and `cox:program:test` require a built artifact at
`packages/cox/target/deploy/cox.so`, or an absolute `COX_PROGRAM_SO` override.
They fail if the compiled program is missing. Build/deployment prerequisites
are in [the deployment guide](packages/cox/deploy/README.md). Deployment does
not initialize a pool or activate publishing.

The publisher's [setup guide](apps/cox-publisher/README.md) explains signer and
pool prerequisites. Archiver/feed-check configuration is documented in
[ingestion](packages/ingestion/README.md). Historical EOX code is preserved at
`eox-archive`; retired economic ingestion and demo commands have been removed.
