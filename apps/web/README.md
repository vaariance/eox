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
| `COX_API_URL` | Server-side base URL for a `cox.app-api/v1` API. Defaults to the live devnet API, `https://cox-app-api-live-529206295845.europe-west1.run.app`. The fixture API is `https://cox-app-api-529206295845.us-central1.run.app`. For a local fixture API, use `http://127.0.0.1:8790`. |
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

## Swap, buy and sell

USDC enters and leaves through the Swap page only: it deposits USDC into the
CRYPTO class and redeems CRYPTO back to USDC (`product.md` version 14), using
the app API's `buildDeposit` and `buildRedeem`. The page presents CRYPTO as
what the user pays with. Asset pages have two actions: Buy is a switch from
CRYPTO into that asset's class, and Sell is a switch back to CRYPTO
(`buildSwitch`). Cash out, on asset pages and on each Portfolio row, redeems
straight from a class to USDC (`buildRedeem`), so leaving does not need a
sale and a swap. The CRYPTO page has no form; it links to Swap. The app does
not use `@cox/client/swap`, whose `CRYPTO_CLASS` is 0 while the program and
`packages/cox/SPEC.md` §3 put CRYPTO last.

Units are shown at 10^(12 + collateral decimals) quanta per displayed unit, so
with USDC one displayed unit is 10^18 quanta. An empty class mints one unit of
10^12 quanta per collateral base unit, so 10 USDC reads as 10 CRYPTO and a
fresh class has a unit value of 1. Requests are still sent in exact quanta.

## Faucet page

The Faucet page links to Solana's devnet SOL faucet and Circle's devnet USDC
faucet, shows the connected wallet's address to paste there, and reads its
devnet SOL and USDC balances (`COX_RPC_URL`, default public devnet). The
navigation no longer links to Publications; the page is still at
`/publications`.

## Gain or loss

The Portfolio page and each "Your position" box show what a position cost,
what it is worth now and the difference, to six decimal places. The app API
has no deposited basis, so `src/lib/basis.ts` works the cost out from the
wallet's filled requests at average cost: a swap in costs its USDC amount, a
buy costs the value moved from CRYPTO (`receipt.proceeds`), and a sale or swap
out reduces the cost in proportion. No figure is shown when the filled
requests do not account for the units held.
