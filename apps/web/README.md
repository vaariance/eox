# COX web app

A Next.js interface for exploring the CRYPTO benchmark, asset performance, publications, portfolios and trading requests on Solana devnet. It reads the versioned COX app API and uses the connected wallet to authorize live trading requests.

The default API serves synthetic fixture data. Fixture pages are labelled and trading controls are disabled. Live mode uses the configured deployment's test collateral; it does not imply mainnet availability or real USDC support.

## Get started

Install workspace dependencies from the repository root, then run:

```sh
pnpm --filter @eox/web dev
```

Open <http://localhost:3100>. The default fixture API is hosted remotely, so a local API is optional. If the configured API is unavailable, the app displays an error and retry control rather than substituting built-in prices.

## Configuration

| Variable | Purpose |
| --- | --- |
| `COX_API_URL` | Server-side base URL for a `cox.app-api/v1` API. Defaults to `https://cox-app-api-529206295845.us-central1.run.app`. For a local fixture API, use `http://127.0.0.1:8790`. |
| `COX_DEMO_WALLET` | Portfolio wallet used with fixture data. Defaults to the first fixture wallet; ignored in live mode. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Browser wallet-adapter RPC. Defaults to public Solana devnet. This value is exposed to browsers; use only an endpoint intended for public client access. |

The browser RPC and API deployment must target the same network. Private infrastructure credentials must not be supplied through `NEXT_PUBLIC_*` variables.

## Data and trading

The app reads through `createCoxApiClient` from [`@eox/app-api`](../../packages/app-api/README.md). Protocol reference values come from the API. Displayed estimates of redeemable collateral multiply holder units by the latest published class state and are labelled approximate.

In live mode, Buy, Switch, Redeem, Cancel, Refund and Withdraw forms use this flow:

1. Convert form values to exact collateral base units and position units at scale 10¹², with an inclusive expiry batch.
2. Request an unsigned transaction from the app API through a server action.
3. Check that the connected wallet is the fee payer and only signer, then ask the wallet to sign.
4. Return signed bytes to the API for broadcast and request-status tracking.

Portfolio, positions and requests belong to the connected wallet and refresh every 15 seconds. Before the first publication, pages retain their layout and show a dash for unavailable values. Trade submission does not imply immediate execution: eligible requests are processed through subsequent accepted publication batches under the protocol's reservation and expiry rules.

The UI supports the request flow, but this README does not establish a completed live wallet-to-fill acceptance test. See the [protocol documentation](../../packages/cox/README.md) for execution and custody rules.

## Build and test

```sh
pnpm --filter @eox/web test
pnpm --filter @eox/web build
pnpm --filter @eox/web start
```

Development and production builds use webpack. [`next.config.ts`](next.config.ts) maps `.js` import specifiers to workspace TypeScript sources through `resolve.extensionAlias`; use the package scripts to preserve that configuration.
