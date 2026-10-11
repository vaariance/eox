# COX API types and client

`@eox/app-api` provides the `cox.app-api/v1` TypeScript contract and HTTP client. It is a workspace package consumed by the application API and web app; it does not read Solana directly, calculate references or sign transactions.

## Read data

```ts
import { createCoxApiClient } from "@eox/app-api";

const api = createCoxApiClient({ baseUrl: "http://127.0.0.1:8790" });
const { data: deployment } = await api.deployment();
const { data: assets, status } = await api.assets();
```

The options accept a custom `fetch` implementation. JSON results contain `schemaVersion`, `deployment`, `status` and `data`. Inspect `deployment.origin` to distinguish synthetic fixtures from live devnet accounts; both use test collateral.

Methods cover deployment, status, assets, benchmark composition, latest and historical publications, publication pages and wallet portfolios. See the [server route reference](../../apps/app-api/README.md) for HTTP paths, configuration and source limitations.

## Exact quantities

| Quantity | Encoding |
|---|---|
| USD price | Decimal integer string, scale 10⁸ (`COX_PRICE_SCALE`) |
| Benchmark and asset reference | Decimal integer string, scale 10¹² (`COX_SCALE`) |
| Reference base of 100 | `"100000000000000"` (`COX_REFERENCE_BASE`) |
| Position units | Decimal integer string, 10¹² quanta per unit |
| Collateral | Decimal integer string in mint base units |
| Sequences, batches and timestamps | JSON numbers; timestamps are Unix seconds |

Use `BigInt` for monetary and fixed-point arithmetic. A relative-performance reference is distinct from a position's collateral value.

`batchFor(now, origin)` returns the earliest scheduled batch after submission and its cutoff +55-second acceptance deadline. Before the origin it returns batch 0; thereafter the batch is `floor((now − origin) / 60) + 1`. This helper estimates eligibility, not execution time. An accepted batch may continue processing beyond one minute.

## Publication streams

```ts
const subscription = api.subscribePublications(null, (event) => {
  console.log(event.sequence, event.publication.identity.stateDigest);
});

await subscription.closed;
```

Pass `null` to start at sequence 0 or a sequence to request later publications. Call `subscription.close()` to stop. The client removes duplicate sequences within a subscription but does not reconnect automatically. Store the last processed sequence and create a new subscription after an interruption. Handle rejection of `subscription.closed` in the calling application.

## Wallet transactions

The client exposes `buildDeposit`, `buildSwitch`, `buildRedeem`, `buildCancel`, `buildRefund` and `buildWithdraw`. Each returns a base64 unsigned transaction plus its blockhash lifetime and request metadata. Building is available only against a live source.

The application inspects the transaction and asks the user's wallet to sign. `submitTransaction(signedBase64)` relays signed bytes; `submission(signature)` checks the API's submission record. Neither method provides a wallet or signs on the user's behalf. A confirmed submission is separate from a committed fill receipt.

For a benchmark-only collateral gateway with direct program readers and builders, see the [COX swap client](../cox-client/README.md).

## Errors and verification

`CoxApiError` contains `code`, `message` and `httpStatus`. Common expected conditions include `NO_PUBLICATION`, `UNKNOWN_WALLET`, `NOT_LIVE` and `TRANSACTION_REJECTED`. Unsupported schema versions are rejected. Typed results do not replace the application's validation of transaction contents and deployment identity.

```sh
pnpm --filter @eox/app-api build
```

Client and route integration tests live in `apps/app-api`.
