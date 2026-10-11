# Signing client

`@eox/signing` provides TypeScript types and an authenticated client for the [COX signing service](../../apps/signer/README.md). Its wire schema is `eox.signing/v1`. The package name and schema identifier are retained for compatibility.

The client discovers public keys and requests policy-restricted Solana signatures. It does not hold private keys, broadcast transactions or sign user trades.

## Usage

Use the package from the pnpm workspace. Supply the service URL and a callback that returns a short-lived Google identity token for the service's configured audience.

```ts
import { createSigningClient } from "@eox/signing";

const signer = createSigningClient({
  baseUrl: signerUrl,
  identityToken: () => getGoogleIdToken(signerAudience),
});

const key = await signer.getPublicKey("oracle-operator");
const result = await signer.signSolanaTransaction({
  requestId,
  role: "oracle-operator",
  keyVersion: key.keyVersion,
  network: key.network,
  operation: { operationId, kind: "publish" },
  expiresAt,
  transactionBase64,
});

if (result.decision === "rejected") {
  throw new Error(`${result.code}: ${result.reason}`);
}

const signedTransactionBase64 = result.signedTransaction;
```

The example assumes transaction construction, operation identity and token generation are supplied by the caller. A discovered key does not grant authority: the caller, operation and exact transaction must satisfy the service policy.

## Request and response contract

- `oracle-operator` is the only active signing role. Admin and upgrade authorities remain separate.
- Requests bind an immutable key version, a `solana:<32-character genesis prefix>` network identifier, operation identity, Unix-second expiry and serialized transaction bytes in base64.
- The client validates request structure and expiry before sending. The service independently checks authorization, instruction policy, account linkage and maximum expiry.
- An identical retry returns the stored decision. Reusing an ID for another caller or changed request returns `REQUEST_ID_CONFLICT`.
- Signing idempotency does not prevent duplicate on-chain actions. Reconcile signatures and chain state before rebuilding a transaction.
- Signed results include the signature, signed transaction, signer identity, payload digest and decision time. Rejections include a typed `RejectionCode` and reason.

`keyDirectory()` returns all public identities. `getPublicKey(role)` requires exactly one active entry for that role. Retired identities are retained only for historical verification. Both methods require authentication.

The optional `fetch` client option supports transport timeouts and custom networking. Handle transport failures separately from a returned policy rejection. Never expose Google identity tokens or authenticated endpoint URLs in browser bundles or logs.

## Development

```sh
pnpm --filter @eox/signing build
pnpm --filter @eox/signing test
```
