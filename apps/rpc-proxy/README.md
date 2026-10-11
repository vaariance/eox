# Solana RPC proxy

Cloudflare Worker that exposes a token-protected Solana JSON-RPC endpoint with ordered upstream failover. It forwards permitted requests unchanged and does not cache responses or hold signing keys.

## Request format

Send JSON-RPC 2.0 using `POST https://<proxy-host>/<client-token>` and `Content-Type: application/json`. Each client should have a separate token so access can be revoked independently. Tokens contain 32–128 characters from `A-Za-z0-9_-`.

Limits are 64 KiB per request body and 20 calls per JSON-RPC batch. Every call in a batch must be allowed. WebSocket subscriptions are not supported.

Allowed methods:

```text
getAccountInfo getBalance getBlockHeight getEpochInfo getFeeForMessage
getGenesisHash getHealth getLatestBlockhash getMinimumBalanceForRentExemption
getMultipleAccounts getProgramAccounts getRecentPrioritizationFees
getSignatureStatuses getSignaturesForAddress getSlot getTokenAccountBalance
getTransaction getVersion isBlockhashValid sendTransaction simulateTransaction
```

The source of truth is `ALLOWED_METHODS` in [src/worker.ts](src/worker.ts).

## Failover behavior

`UPSTREAM_URLS` sets the HTTPS upstream order. Network failures, a 15-second timeout, HTTP 401, 403, 408, 429 or HTTP 5xx advance to the next upstream; 401 and 403 mean the upstream refused the proxy (for example a blocked address or a rejected key), not that the request was invalid. Other HTTP responses, including JSON-RPC errors returned with HTTP 200, are passed through. If every upstream fails, the proxy returns HTTP 502.

Responses use `Cache-Control: no-store` and `x-rpc-upstream`, which contains the selected upstream's zero-based index. Logs identify an upstream by index rather than its URL. Clients can additionally configure a direct backup RPC if they need to tolerate a Worker outage.

Forwarding `sendTransaction` again after an upstream timeout sends the same signed bytes; it does not build or sign a replacement transaction. Callers remain responsible for signature reconciliation.

## Configure and deploy

Install workspace dependencies. Review `wrangler.toml` and set the account, Worker name and routes for your deployment. Set secrets interactively:

```sh
cd apps/rpc-proxy
npx --yes wrangler@4.140.0 login
npx --yes wrangler@4.140.0 secret put UPSTREAM_URLS
npx --yes wrangler@4.140.0 secret put ACCESS_TOKENS
pnpm --filter @eox/rpc-proxy deploy
```

Both secrets contain whitespace-separated lists. A typical upstream order is a dedicated devnet provider followed by the public devnet endpoint. All upstreams must serve the same network; this Worker does not check genesis itself. Applications must verify the expected genesis before using it.

Authenticated proxy URLs contain credentials in their path. Keep them out of source control, screenshots and logs. Revoke a client by replacing `ACCESS_TOKENS` without its token. Empty or invalid configuration returns HTTP 503; missing or invalid tokens return 401; forbidden methods return 403.

## Verification

```sh
pnpm --filter @eox/rpc-proxy build
pnpm --filter @eox/rpc-proxy test
```

Tests cover authentication, limits, method filtering, forwarding and failover with mocked upstreams.
