# COX web app

Next.js app for the COX devnet MVP (`product.md` task G3).

```sh
pnpm --filter @eox/app-api-server start
COX_DEMO_WALLET=<fixture wallet> pnpm --filter @eox/web dev
```

The app opens on <http://localhost:3100> and reads the COX app API through
`createCoxApiClient`. There is no built-in data: without a reachable API it
shows an error page with a retry button. The fixture server's assets, prices
and wallets are synthetic, and the app labels them on every page.

| Variable | Meaning |
| --- | --- |
| `COX_API_URL` | Base URL of a `cox.app-api/v1` server. Defaults to `http://127.0.0.1:8790`. |
| `COX_DEMO_WALLET` | Wallet whose portfolio is shown. Unset means no portfolio. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Solana RPC for the wallet adapter. Defaults to public devnet. |

The app is built with webpack (`next dev --webpack`, `next build --webpack`).
Turbopack cannot resolve the `.js` import specifiers in `@eox/app-api` to its
TypeScript sources; webpack does, through `resolve.extensionAlias` in
`next.config.ts`.

Every page reads through `src/lib/data.ts`, which returns the types from
`@eox/app-api`. The app computes no reference and no claim value; the
"redeemable, about" figures are a holder's units multiplied by the latest
published class state and are labelled as approximate.

## Sending requests

Buy, Switch and Redeem build a real transaction in the browser with Peter's
`@cox/client` (`src/lib/chain.ts`): it reads the pool for the next request
number, derives the position, request, vault and token accounts, builds the
`deposit`, `switch` or `redeem` instruction and hands it to the connected
wallet to sign and send. Amounts are parsed as exact integers
(`src/lib/requests.ts`); nothing is rounded.

The buttons stay disabled until the API reports a live pool (`origin: "live"`
with a pool address and collateral decimals). No pool exists on devnet yet, so
this path has never sent a transaction. What has been checked: the planning
and instruction encoding (`pnpm --filter @eox/web test`), and that the browser
bundle produces the same instruction bytes as Node.

Two small shims in `next.config.ts` make `@cox/client` load in the browser: its
`node:crypto` import is replaced (hashing is not needed to build a request),
and its default import of `@coral-xyz/anchor` is given a default export.

Not connected yet: Cancel and Withdraw, and the portfolio of the connected
wallet. `product.md` gives transaction building to the app API (J5); this
in-browser path exists so the forms work as soon as a pool does and can be
replaced by the API's builders.
