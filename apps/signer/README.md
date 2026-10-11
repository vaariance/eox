# signer (Joel)

The COX signing service (`product.md` §8.14 and J4). It signs Solana transactions
for the one runtime role, `oracle-operator`, using a non-exportable Google Cloud
KMS key. Callers use `@eox/signing` (`packages/signing`).

## Keys

Key ring `eox-signing-dev` (us-central1, project `colosseum-eox`) holds one key per
role. Public identities are in `deploy/signing/dev-keys.json` (key directory
version 2) and at `GET /v1/keys`.

| Role | Chain | KMS algorithm | Protection | State |
|---|---|---|---|---|
| `oracle-operator` | Solana devnet | `EC_SIGN_ED25519` | software (KMS has no HSM Ed25519) | active |
| `solana-relayer` | Solana devnet | `EC_SIGN_ED25519` | software | retired 2026-10-11 |
| `uma-asserter`, `uma-challenger`, `oracle-checker`, `evm-relayer` | Sepolia | `EC_SIGN_SECP256K1_SHA256` | HSM | retired 2026-10-11 |

Retired roles had no COX use. Their KMS key versions are disabled, not destroyed,
and their public keys stay in the directory as `retired` with `validUntil`, so
signatures they made can still be verified. The signer refuses them as unknown
roles and serves no EVM route.

Only the `eox-signer` service account has `roles/cloudkms.signerVerifier` on the key
ring. Admin and upgrade authorities never live here.

## How a request is decided

1. **Authenticate:** the caller's Google identity token must be valid for this
   service's audience and belong to a service account listed in `callers`. No audience
   configured means nobody is authenticated.
2. **Validate:** schema version, request ID, role/chain/network consistency, operation
   identity, transaction encoding, and an expiry no more than 600 seconds ahead.
3. **Replay:** a request ID already decided returns the recorded result when caller and
   request are identical, and `REQUEST_ID_CONFLICT` otherwise. Decisions live in the
   Firestore collection `signRequests`.
4. **Authorize:** the caller must hold the role, and the request must name that role's
   active key version and network.
5. **Policy:** the transaction is decoded and checked against `bindings` for the role.
   - **Solana:** the key must be the fee payer; every instruction must be a bound
     program and 8-byte discriminator, apart from compute-unit limit and capped
     compute-unit price; address lookup tables are refused.
6. **Sign:** KMS signs the message bytes; the signature is verified against the
   key before it is returned.

Every decision except a KMS outage is recorded and logged with caller, role, request
ID, payload digest and outcome. Responses: `200` signed, `403` rejected with a
`RejectionCode`, `401` unauthenticated, `503` signer unavailable.

## Binding a deployment

Signing is disabled for every target until its deployed address is added to
`config/<environment>.json` under `bindings`, and each caller is listed under `callers`
with its roles. Change the config by commit and redeploy. Never widen a role to make a
request pass.

## COX publisher binding (J4)

`config/dev.json` binds `oracle-operator` to the devnet COX program
`G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF` for `publish`, `evaluate`, `safety`,
`seal_evaluation`, `execute` and `finalize` only, for pool 0
(`Fn3Xuh7CVxjcRpqJEnGR1isPy2GVBBsdiAbuhfpoVbHb`) and its sealed methodology
(`Hk37dxaRjEzcngRoXRCc9N4bkqKRMCDofqTFEQ7CWyMw`). It was enabled on 2026-10-11
after Peter activated the pool; `enabled: false` refuses every request with
`TARGET_NOT_BOUND`.

Checks per transaction, on top of the general rules above:

- the registry, pool 0, its vault and its reusable batch
  (`CckMCGwaEDcRbHogJLa79GRU74nFPAJtLEe3GSyzzHtb`, seeds `batch`, pool) and
  publication (`J5Jyo9xBvaEeG5g6n5CE85SS9sy9zBriHHx3giUAEnZC`, seeds
  `publication`, pool) at their IDL positions; `publish` and `finalize` must be
  paid by the operator key, which is also `publish`'s runtime authority; the
  system program where the IDL has it. Batch and publication may not exist
  before their first creation and are not read;
- `cox-v2` linkage: the bound sealed methodology for `publish` and `finalize`;
  for the cranks, the request account is read and must be the request PDA of its
  nonce in pool 0, and the position must be its owner's position PDA;
- the linkage reads go over `SIGNER_SOLANA_RPC_URLS`, an ordered,
  whitespace-separated list of https URLs. Every URL must answer with the devnet
  genesis at start-up; a request moves to the next URL on a network error,
  timeout (15 s), HTTP 429 or 5xx and stays there while it works. The list holds
  an API key, so it lives in Secret Manager (`solana-devnet-rpc-urls`, read by
  `eox-signer` only) and is never committed or logged; logs name hosts only;
- compute unit limit at most 1,400,000 and price at most 1,000 micro-lamports;
  no lookup tables, no heap frame, no other program.

Only `cox-publisher@colosseum-eox.iam.gserviceaccount.com` may call it; it holds
`roles/run.invoker` on this service. The dev VM's account (`eox-dev-vm`) holds
`roles/iam.serviceAccountOpenIdTokenCreator` on it, so a process on `eox-dev` gets
its identity token without any key file:

```bash
AT=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | jq -r .access_token)
curl -s -X POST -H "Authorization: Bearer $AT" -H "Content-Type: application/json"   -d '{"audience":"https://eox-signer-529206295845.us-central1.run.app","includeEmail":true}'   https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/cox-publisher@colosseum-eox.iam.gserviceaccount.com:generateIdToken
```

In Node, `new IAMCredentialsClient().generateIdToken({ name: "projects/-/serviceAccounts/cox-publisher@colosseum-eox.iam.gserviceaccount.com", audience, includeEmail: true })`
does the same; pass the token to `createSigningClient({ identityToken })`.

## Commands

```bash
pnpm --filter @eox/signer test
GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token --account=$GCP_ACCOUNT) \
  pnpm --filter @eox/signer -s key-directory config/dev.json > deploy/signing/dev-keys.json
GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token --account=$GCP_ACCOUNT \
  --impersonate-service-account=eox-signer@colosseum-eox.iam.gserviceaccount.com) \
  npx tsx apps/signer/scripts/prove-adapters.ts apps/signer/config/dev.json
```

`prove-adapters.ts` signs a real Solana devnet transaction with the KMS key, verifies
it through devnet signature verification and broadcasts it when the account is
funded.
