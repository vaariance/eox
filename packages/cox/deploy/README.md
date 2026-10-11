# COX devnet deployment

`devnet.json` reserves the new COX identity. It does not claim a deployment.
The former EOX program is never upgraded. Runtime publication uses the
existing `oracle-operator` KMS key. The deployment wallet, program identity
and upgrade authority are separate local devnet keys under ignored `.cox/keys`.
No runtime private key exists there. Preserve the upgrade key securely.

Build using the pinned Anchor 0.31.1 dependencies, Agave SBF wrapper 2.2.1
and platform tools v1.48 (Rust 1.84.1-dev):

```sh
node packages/cox/scripts/deployment.ts build --solana-bin /path/to/solana-release/bin --platform-tools /path/to/v1.48/platform-tools
```

The build records source digests, tool version, binary size and SHA-256 under
`.cox/reviewed-build.json`. Run the compiled-program tests before review.
After Peter approves the concrete commits, rebuild the exact approved commit
on any branch and run:

```sh
node packages/cox/scripts/deployment.ts deploy --solana-bin /path/to/solana-release/bin --platform-tools /path/to/v1.48/platform-tools --approved-commit FULL_COMMIT_SHA
```

The script requires a clean committed COX tree, checks the approved build,
verifies that HEAD and the reviewed build match the approved commit, pins
the devnet genesis hash and checks the public identities of all local keys.
Deployment has no branch or remote-membership requirement.
It deploys only the program. It creates no mint, pool, methodology or live
publication. Faucet test SOL funds the deployment wallet; it is not collateral.

The script then downloads the deployed executable, verifies the reviewed
bytes (allowing only zero allocation padding) and the separate upgrade
authority, and writes `deployed-devnet.json` with actual chain information.
Only that verified record establishes the deployed program and build hash.
Joel binds the signer to the verified address and permitted instructions
in the integration handoff. Live-pool activation is a separate task.

## Toolchain setup used for local verification

Agave wrapper 2.2.1 reports a default platform v1.44. This release instead
explicitly uses platform v1.48 (`rustc 1.84.1-dev`). The local wrapper's
`platform-tools-sdk/sbf/scripts/install.sh` platform-version variable was
changed from v1.44 to v1.48, and
`platform-tools-sdk/sbf/dependencies/platform-tools` links to that installed
v1.48 tree. This ensures both compilation and the strip tool use the same
platform. The repository build script does not modify a system installation;
prepare a dedicated SDK tree with this alignment before invoking it. The
wrapper's banner still mentions its original default; the reviewed build
records the actual compiler version and SHA-256 separately.

The local deployment wallet currently has zero devnet SOL. Faucet requests
were rate limited. Reserve 10 test SOL for deployment: current RPC rent quotes
are 4.72125548 SOL for the 929,253-byte program-data account and 4.72121484 SOL
for the 929,245-byte temporary buffer, plus the small program account and
transaction fees. These are devnet test tokens, not user collateral. Recheck
rent and balance before deploying; unused buffer funds are recoverable.
