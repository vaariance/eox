# COX web app

Next.js app for the COX devnet MVP (`product.md` task G3).

```sh
pnpm --filter @eox/web dev
```

It opens on <http://localhost:3100> with built-in sample data for the 30 pilot
assets. The sample is for layout only and is labelled on every page.

To read from the app API instead, start the fixture server and point the app at
it:

```sh
pnpm --filter @eox/app-api-server start
COX_API_URL=http://127.0.0.1:8790 COX_DEMO_WALLET=<fixture wallet> pnpm --filter @eox/web dev
```

| Variable | Meaning |
| --- | --- |
| `COX_API_URL` | Base URL of a `cox.app-api/v1` server. Unset means sample data. |
| `COX_DEMO_WALLET` | Wallet whose portfolio is shown. Unset means no portfolio. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Solana RPC for the wallet adapter. Defaults to public devnet. |

Every page reads through `src/lib/data.ts`, which returns the types from
`@eox/app-api`. The app computes no reference and no claim value; the
"redeemable, about" figures are a holder's units multiplied by the latest
published class state and are labelled as approximate.

Not connected yet: the portfolio of the connected wallet, and sending buy
(deposit), switch, redeem, cancel and withdraw requests. Both wait for the live app API.
