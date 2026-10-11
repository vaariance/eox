# COX web app

Next.js app for the COX devnet MVP (`product.md` task G3).

```sh
pnpm --filter @eox/web dev
```

The app opens on <http://localhost:3100> and reads the COX app API through
`createCoxApiClient`. By default that is the public fixture service on Cloud
Run, so nothing else needs to be running. There is no built-in data: if the
API cannot be reached the app shows an error page with a retry button. The
fixture's assets, prices and wallets are synthetic, and the app labels them on
every page.

| Variable | Meaning |
| --- | --- |
| `COX_API_URL` | Base URL of a `cox.app-api/v1` server. Defaults to the public fixture, `https://cox-app-api-529206295845.us-central1.run.app`. Use `http://127.0.0.1:8790` for a local `pnpm --filter @eox/app-api-server start`. |
| `COX_DEMO_WALLET` | Wallet whose portfolio is shown. On fixture data it defaults to the first fixture wallet; on live data, unset means no portfolio. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Solana RPC for the wallet adapter. Defaults to public devnet. |

The app is built with webpack (`next dev --webpack`, `next build --webpack`).
Turbopack cannot resolve the `.js` import specifiers in `@eox/app-api` to its
TypeScript sources; webpack does, through `resolve.extensionAlias` in
`next.config.ts`.

Every page reads through `src/lib/data.ts`, which returns the types from
`@eox/app-api`. The app computes no reference and no claim value; the
"redeemable, about" figures are a holder's units multiplied by the latest
published class state and are labelled as approximate.

Not connected yet: the portfolio of the connected wallet, and sending buy
(deposit), switch, redeem, cancel and withdraw requests. Both wait for the live app API.
