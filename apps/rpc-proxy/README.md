# rpc-proxy (Joel)

Cloudflare Worker `cox-rpc-proxy`: one Solana devnet JSON-RPC endpoint for
Joel's services (signer, live app API). It forwards each request unchanged to
the first upstream in `UPSTREAM_URLS` and moves to the next on a network error,
a 15 s timeout, HTTP 429 or 5xx. A client error (4xx other than 429) is returned
as it is. Responses are never cached.

Access: `POST https://cox-rpc-proxy.<account>.workers.dev/<token>` with
`content-type: application/json`. `<token>` is one of `ACCESS_TOKENS` (32 to
128 characters of `A-Za-z0-9_-`, compared in constant time); give each client
its own token so one can be revoked alone. Only the read, simulate and send
methods the services use are forwarded (`ALLOWED_METHODS` in `src/worker.ts`),
batches up to 20 calls, bodies up to 64 KiB. Logs carry the upstream index,
never its URL.

Secrets, set with wrangler and never committed:

```bash
cd apps/rpc-proxy
npx --yes wrangler@4.140.0 login
npx --yes wrangler@4.140.0 secret put UPSTREAM_URLS    # e.g. "<helius devnet url with key> https://api.devnet.solana.com"
npx --yes wrangler@4.140.0 secret put ACCESS_TOKENS    # whitespace-separated, one per client
pnpm --filter @eox/rpc-proxy deploy
```

Clients list the proxy first and public devnet directly after it in their own
failover list (`COX_RPC_URLS`, `SIGNER_SOLANA_RPC_URLS`), so a Worker outage
does not stop them. The proxy URL with its token is a secret: Secret Manager
`solana-devnet-rpc-urls` for the signer, `/opt/eox/cox-app-api-live.env`
(root, 600) on the dev VM.

Each developer runs their own proxy for their own services.
