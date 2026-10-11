# Retained EOX readers and P4 carry-over

The EOX worker CLI, proposal runner and authenticated relay helpers are retired.
The old deployed program is abandoned in place and is never upgraded for COX.
Use `packages/cox` and `@cox/client` for the replacement program.

Joel's existing app API still imports `@eox/oracle-worker/references` and the
EOX IDL. Those readers, their types and tests remain until his COX API lands.
This package exports only that retained reader entry point.

P4 still needs the durable journal, PID lock, retry policy and real-RPC
transport patterns. `journal.ts`, `retry.ts` and `solana.ts` remain as carry-over
material. The old transport imports `codec.ts`, which imports `provider.ts`
and `publication.ts`; those exact dependencies remain temporarily so this
package stays buildable. They are EOX-only, have no COX publisher role and
must be removed after P4 replaces the transport. `types.ts` also supports the
retained reference reader and journal. The carry-over journal and transport
use old EOX schemas; P4 must replace those schemas and the wallet-file signer
with the remote KMS signing client.

`REFERENCE-READERS.md` and `examples/read-reference.ts` describe Joel's existing
reader integration. `pnpm --filter @eox/oracle-worker build` and `test` verify
these retained components. No EOX service or local database is changed here.
