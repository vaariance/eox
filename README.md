# COX — Crypto Outlook Index

COX measures crypto assets against a common crypto benchmark and makes that
relative performance tradeable through collateral-backed positions on Solana.
An asset's dollar price can rise while its performance against the benchmark
falls. COX separates those two measures.

This repository contains the price archive, calculation engine, Solana program,
transaction clients, APIs, publisher, independent checker and web application.
The current mechanism is an experimental Solana devnet implementation using
six-decimal test collateral. It does not support real-money deposits. A running
service or deployed program alone does not establish end-to-end trading readiness.

## How it works

1. Archive closed one-minute candles from Kraken, Coinbase and Bybit using a
   deterministic fallback and USD conversion policy.
2. Calculate an equal-weight CRYPTO benchmark and each asset's performance
   relative to it, using exact fixed-point arithmetic.
3. Accept a snapshot on Solana and fix the batch's execution values before
   processing eligible requests.
4. Finalize position changes and redemption payables together. Users withdraw
   committed payables in a separate transaction.

New requests become eligible at a future publication; they never execute against
an immediate price supplied by the submitter. Acceptance windows apply to
snapshots, not trade completion. An accepted batch retains its prices through
pauses and restarts and must finish before another publication starts.

Positions are claims within one closed collateral pool, rather than wallet-held
BTC, ETH or other spot tokens. The mechanism uses no leverage. Custody accounting
reconciles vault tokens against active backing, pending deposits, payables and
non-distributable residual. Reference index levels are separate from redeemable
position value.

Exchange data is attested by the runtime publisher. Deterministic checks and an
independent monitor improve verification but do not make unsigned venue data
trustless. See the [mechanism specification](packages/cox/SPEC.md) for arithmetic,
accounting, timing and safety rules.

## Repository map

| Component | Purpose |
| --- | --- |
| [COX program and math](packages/cox/README.md) | Rust calculation engine, Anchor program, fixtures and custody tests |
| [Methodology](packages/cox-methodology/README.md) | Canonical manifests, price encoding and specification vectors |
| [Solana client](packages/cox-client/README.md) | Account readers, unsigned instruction builders and simulations |
| [Price feeds](packages/price-feeds/README.md) | Rate-limited venue clients and exact price conversion |
| [Ingestion](packages/ingestion/README.md) | Minute snapshot archive and feed reports |
| `packages/evidence-store` | Append-only PostgreSQL evidence and price storage |
| [Evidence API](apps/evidence-api/README.md) | Archived snapshots and source artifacts |
| [App API](apps/app-api/README.md) | Fixture/live data, portfolios and wallet transaction preparation |
| [App API client](packages/app-api/README.md) | Versioned API types and HTTP client |
| [Publisher](apps/cox-publisher/README.md) | Snapshot publication and persistent batch execution |
| [Signer](apps/signer/README.md) | Restricted runtime signing through Cloud KMS |
| [Signing client](packages/signing/README.md) | Typed signing requests and public-key discovery |
| [RPC proxy](apps/rpc-proxy/README.md) | Authenticated JSON-RPC forwarding and upstream failover |
| [Monitor](apps/cox-monitor/README.md) | Independent archive and optional venue checks |
| [Web app](apps/web/README.md) | Market views and wallet interaction |
| [Dev infrastructure](deploy/dev/README.md) | VM services, logs, database and backups |

Some package names retain the `@eox/` namespace. Use the names in their package
manifests when running workspace commands.

## Local setup

Use Node.js 24 or newer, pnpm and Docker with Compose. Rust and Solana build tools
are required only for the program and calculation-engine workflows; their pinned
versions are documented in the [deployment guide](packages/cox/deploy/README.md).
Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
```

The local database defaults to `postgres://eox:eox@localhost:5433/eox`. Set
`DATABASE_URL` in the service environment to use a different database. The
Compose credentials are for local development and must be replaced on a shared
host. Copying an `.env` file does not automatically export it to every Node process.

Start the fixture API and web app in separate terminals:

```sh
pnpm --filter @eox/app-api-server start
COX_API_URL=http://127.0.0.1:8790 pnpm --filter @eox/web dev
```

Open `http://localhost:3100`. Fixture data is synthetic and cannot execute trades.
Each service README explains its configuration and dependencies. The publisher
ships disabled; starting local demos does not activate it or create on-chain
accounts.

## Checks

```sh
pnpm -r build
pnpm -r test
```

Database-backed tests require PostgreSQL and migrations; program/client checks
may require generated artifacts and a compiled Solana binary. Follow the
[compiled-program test instructions](packages/cox/crates/program-tests/README.md)
for real SPL token custody tests rather than relying only on host-side math.

## Deployment and security

[Program deployment](packages/cox/deploy/README.md), service installation and pool
activation are separate operations. Verify the chain, program build, methodology,
collateral mint and signing authorities before enabling publishing. Local keys
for administration and upgrades remain separate from the non-exportable runtime
key. Users sign trades with their own wallets.

Keep database passwords, RPC access tokens and provider keys out of source control
and logs. Consult each component's documented limitations before operating it;
fixture APIs, archive-only monitor verdicts and local simulation results are not
proof of production readiness.
