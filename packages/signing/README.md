# @eox/signing (Joel)

Types and the typed client for the EOX signing service (`product.md` §8.14).
The service itself (`apps/signer`, Google Cloud KMS) is step 4 and not built yet.

```ts
import { createSigningClient } from "@eox/signing";

const signer = createSigningClient({ baseUrl, identityToken: () => getGoogleIdToken(audience) });
const key = await signer.getPublicKey("oracle-operator");
const result = await signer.signSolanaTransaction({
  requestId, role: "oracle-operator", keyVersion: key.keyVersion,
  network: key.network, operation: { operationId, kind: "upload_evidence_page" },
  expiresAt, transactionBase64,
});
if (result.decision === "rejected") throw new Error(`${result.code}: ${result.reason}`);
```

## Contract

- **One interface, separate keys.** Each role has its own key per chain and
  environment: `oracle-operator` and `solana-relayer` (Solana, Ed25519);
  `uma-asserter`, `uma-challenger`, `oracle-checker` and `evm-relayer` (EVM,
  secp256k1). Admin and upgrade keys are never available through this service, and
  no infrastructure key signs a user's trade.
- **Every request** carries a request ID, role, immutable key version, CAIP-2
  network (`eip155:<chainId>` or `solana:<genesis hash prefix>`), operation identity,
  expiry and the exact transaction bytes. The client validates these before sending.
- **Idempotency:** an identical retry returns the recorded result; different bytes
  under the same request ID are rejected with `REQUEST_ID_CONFLICT`. Signing
  idempotency does not prevent a duplicated on-chain action: callers reconcile chain
  state before rebuilding a transaction.
- **Policy:** the service decodes each transaction and signs only allowlisted
  operations for the caller's role. Rejections return a `RejectionCode`, never a
  partial signature.
- **Key directory:** `GET /v1/keys` lists public keys and addresses with role, key
  version, state and validity. Discovery does not grant authority; contracts pin the
  authorized addresses.
- **Authentication:** callers send a Google-signed identity token for their service
  account.
