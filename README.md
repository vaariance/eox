# eox

Monorepo for EOX. pnpm workspaces, three packages under `packages/`, apps under `apps/`.

| Folder | Owner | Purpose |
|---|---|---|
| `packages/ingestion` | Peter | Fetch data from sources |
| `packages/evidence-store` | Joel | Store facts forever, append-only |
| `packages/optimistic-oracle` | Godwin | Optimistic oracle that makes each year's result final: EVM adapter for UMA (`evm/`) and the Solana settlement program (`solana/`) |
| `apps/` | later | API, web app |
| `docs/` | everyone | Guides |

## Setup

```bash
pnpm install
pnpm db:up
pnpm db:migrate
pnpm demo
```

Requires Node 20+, pnpm 9+, Docker.
