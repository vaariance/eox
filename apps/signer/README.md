# signer (Joel)

The EOX signing service from `product.md` §8.14. One HTTP interface signs
Solana and EVM transactions for the infrastructure roles, using non-exportable
Google Cloud KMS keys. Callers use `@eox/signing` (`packages/signing`).

## Keys

Key ring `eox-signing-dev` (us-central1, project `colosseum-eox`) holds one key per
role. Public identities are in `deploy/signing/dev-keys.json`.

| Role | Chain | KMS algorithm | Protection |
|---|---|---|---|
| `oracle-operator`, `solana-relayer` | Solana devnet | `EC_SIGN_ED25519` | software (KMS has no HSM Ed25519) |
| `uma-asserter`, `uma-challenger`, `oracle-checker`, `evm-relayer` | Sepolia | `EC_SIGN_SECP256K1_SHA256` | HSM |

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
   - **EVM:** EIP-1559 only, bound contract and selector, value/fee/gas limits, no
     contract creation, access lists or EIP-7702 delegations.
   - **Solana:** the key must be the fee payer; every instruction must be a bound
     program and 8-byte discriminator, apart from compute-unit limit and capped
     compute-unit price; address lookup tables are refused.
6. **Sign:**
   - **Solana:** KMS signs the message bytes; the signature is verified against the
     key before it is returned.
   - **EVM:** KMS signs the Keccak-256 transaction digest; the DER signature is
     normalised to low-s and must recover to the key's address.

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
`seal_evaluation`, `execute` and `finalize` only. The binding is **prepared but
disabled** (`enabled: false`): every request is refused with `TARGET_NOT_BOUND`
until Peter supplies the initialized pool, vault, mint and sealed methodology and
the binding is switched on with `linkage.methodology` set.

Checks per transaction, on top of the general rules above:

- the registry, pool 0 and its vault PDAs at their IDL positions; `publish` and
  `finalize` must be paid by the operator key, which is also `publish`'s runtime
  authority; the system program where the IDL has it;
- `cox-v1` linkage, read over `SIGNER_SOLANA_RPC_URL` (devnet, genesis checked at
  start-up): the batch PDA of `publish`'s batch id; for the cranks the batch,
  request and the request owner's position PDAs, read from the stored batch and
  request accounts; for `finalize` the publication PDA of the batch's sequence; the
  bound sealed methodology for `publish` and `finalize`;
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

`prove-adapters.ts` signs a real Solana devnet and a real Sepolia transaction with the
KMS keys. It verifies them through devnet signature verification and local EVM
recovery, and broadcasts them when the accounts are funded.
