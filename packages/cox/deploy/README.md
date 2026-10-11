# COX devnet deployment

This directory contains configuration and recorded release information for the COX Solana program. It targets devnet and test collateral.

| File | Purpose |
| --- | --- |
| `devnet.json` | Expected network, program identity, authorities and toolchain |
| `deployed-devnet.json` | Verified release commit, executable hash, deployment transaction and on-chain authority |
| `signer-allowlist.json` | Permitted runtime instructions and their discriminators |
| `initialized-devnet.json` | Recorded registry, sealed methodology, test mint, pool and vault initialization |
| `methodology-devnet.json` | Sealed methodology inputs and canonical bytes |
| `publisher-devnet.json` | Repository publisher configuration template |
| `publisher-running-devnet.json` | Dated runtime installation and verification record |

The program address is `G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF`. Treat the deployment record as a release record, rather than current pool or publisher status. Deploying the executable does not initialize a registry, seal a methodology, create collateral or activate a pool.

## Requirements

Run commands from the repository root with Node.js 24 and the pinned toolchain:

- Anchor dependencies: `0.31.1`.
- Agave SBF wrapper: `2.2.1`.
- Platform tools: `v1.48`, using `rustc 1.84.1-dev`.
- A generated IDL whose address matches the configured program.
- A funded devnet deployment wallet and the separately controlled program and upgrade keys.

Local keys are stored under ignored `.cox/keys` as `cox-program-keypair.json`, `cox-admin-keypair.json` and `cox-upgrade-keypair.json`. Their public identities must match `devnet.json`; files must not be readable by other users. Preserve the upgrade key securely. Runtime publishing uses the non-exportable `oracle-operator` KMS identity; never create a local copy of its private key.

Keep authenticated RPC URLs in private configuration. Never commit or log provider API keys or proxy access tokens.

## Build and review

```sh
node packages/cox/scripts/deployment.ts build \
  --solana-bin /path/to/solana-release/bin \
  --platform-tools /path/to/v1.48/platform-tools
```

The build records source digests, IDL hash, tool versions, compiler hash, binary size and executable SHA-256 in ignored `.cox/reviewed-build.json`. Run the [compiled program tests](../crates/program-tests/README.md) against that artifact and review the exact release commit before deployment.

The Agave 2.2.1 wrapper's default platform version is v1.44. This release explicitly requires v1.48. Prepare a dedicated SDK tree whose `platform-tools-sdk/sbf/scripts/install.sh` platform version and `platform-tools-sdk/sbf/dependencies/platform-tools` link both use v1.48, so compilation and stripping use the same platform. The repository script does not modify system tool installations.

## Deploy

After the concrete release commit is approved, build that committed revision and run:

```sh
node packages/cox/scripts/deployment.ts deploy \
  --solana-bin /path/to/solana-release/bin \
  --platform-tools /path/to/v1.48/platform-tools \
  --approved-commit FULL_COMMIT_SHA
```

The script requires a clean committed `packages/cox` tree, matching HEAD/reviewed-build/approved commit identities, matching local key identities and the pinned devnet genesis hash. Deployment may run from any branch; there is no remote-membership requirement. Recheck devnet SOL balance, program rent and transaction fees before each deployment. Devnet SOL used for fees and rent is separate from pool collateral.

The script downloads the deployed executable, compares it with the reviewed build while allowing only zero allocation padding, verifies the upgrade authority and writes `deployed-devnet.json`. A mismatch fails verification.

## Verify an existing deployment

With the matching reviewed build and toolchain present:

```sh
node packages/cox/scripts/deployment.ts verify \
  --solana-bin /path/to/solana-release/bin \
  --platform-tools /path/to/v1.48/platform-tools
```

A verified executable is only one part of activation. Pool initialization must bind the intended registry, sealed methodology, mint and vault. The signing service must independently bind those accounts, the verified program and approved runtime instructions before enabling publication. Admin operations, upgrades, wallet trades and token transfers remain outside the runtime signer allowlist. See the [publisher guide](../../../apps/cox-publisher/README.md) for runtime configuration and execution.
