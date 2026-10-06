# EOX Resolution Plan

How EOX turns stored economic data into a final, on-chain result for each year, what is
built, and what to build next.

> Rebuilt on 2026-10-06 from the code, READMEs and commit history of
> `feat/resolution-oracle` (head `d470928`) and `main` (head `f766c63`). The original
> plan was never committed (`docs/` is gitignored), so any decision recorded only in the
> original is missing here. This file lives at the repo root so git keeps it.

## 1. What we are building

Each calendar year is an **epoch**. Once the epoch's evidence cutoff passes, the result
for that year (country scores against a world benchmark) is posted on Solana and becomes
final. Nobody takes the result on trust: anyone can re-run the engine on the published
evidence and get the same bytes.

```
sources ──▶ ingestion ──▶ evidence-store ──▶ snapshot-exporter ──▶ eox-engine
 (OECD,BIS,   (Peter)       (Joel, append-     (official rows       (Godwin, scores +
  PortWatch)                 only, bitemporal)  as of cutoff)        merkle root + hash)
                                                                          │
                                         eox-oracle bots ◀────────────────┘
                                   (propose · watch · crank)
                                                 │
                         eox_settlement_oracle ◀─┴─▶ eox_arbiter
                         (epochs, bonds, disputes)    (3-member panel)
```

### Settlement rules (as implemented on-chain)

1. Epoch `Y` has its evidence cutoff at **31 July Y+1, 00:00 UTC**. Whatever the evidence
   store knew by then is what counts.
2. Within **48 h** an approved proposer posts a claim and locks a bond. The claim holds
   hashes only: evidence root, methodology image ID, output hash, resolution URI hash.
3. Anyone can challenge within **72 h** by locking the same bond. If nobody does, the
   claim settles.
4. A first challenge throws the claim out. The next claim has 48 h and needs **2× the bond**.
5. A second challenge goes to the panel, which has **14 days**. Two matching votes decide.
6. Any missed deadline voids the epoch and refunds every bond. The longest path fits in
   the 30-day backstop.
7. The winner gets their bond back plus **90%** of the loser's. The other **10% is burned**.
   Payouts are pull-based: each party withdraws their own.

A challenge has to name its grounds:
- `WrongObservation`: names one observation, with a Merkle proof checked on-chain.
- `MissingObservation`: the panel judges it.
- `Computation`: the panel judges it for now. Goes away once the zk proof layer exists.

The principle is **"prove, don't vote"**. See `packages/apps/onchain/README.md` for why
we didn't use UMA.

## 2. Status by component

| Component | Where | Branch | Status |
|---|---|---|---|
| Evidence store | `packages/evidence-store` | both (newer on `main`) | ✅ Done. Append-only, bitemporal. `main` adds `source_payloads`, `raw_value`, coverage, and DB-stamped `recorded_at` (migration 005) |
| Ingestion | `packages/ingestion` | `main` only | ✅ 6 indicators × 30 OECD/BIS pilot countries: container throughput, real estate, real GDP vintages, core CPI, unemployment, policy rate |
| Dev deploy | `deploy/dev` | `main` only | ✅ VM provisioning, ingest cron, deploy script |
| Snapshot exporter | `packages/snapshot-exporter` | `feat/resolution-oracle` | ✅ Exports one official-source row per country/indicator as of a date. Built against the **old** evidence-store types |
| Engine `eox-engine` | `packages/apps/methodology` | `feat/resolution-oracle` | ✅ v0.1: fixed-point math, normalization, weights, WORLD-ex-self benchmark, min 3 indicators per country, cutoff and epoch-year checks, Merkle tree, canonical encoding, output hash. 33 tests pass |
| Settlement program | `packages/apps/onchain/programs/eox_settlement_oracle` | `feat/resolution-oracle` | ✅ Initialize (upgrade authority only), proposer list, open epoch, propose, dispute (incl. on-chain Merkle check), settle, escalate, void, withdraw, burn. 63 LiteSVM tests |
| Arbiter program | `packages/apps/onchain/programs/eox_arbiter` | `feat/resolution-oracle` | ✅ 3 bonded members, open case, vote, CPI into `resolve_arbitration` on a 2-of-3 majority. 15 LiteSVM tests |
| Oracle bots `eox-oracle` | `packages/apps/eox-oracle` | `feat/resolution-oracle` | 🟡 `propose`, `watch`, `crank` and `run-engine` CLI written against the `Chain` trait. 22 bot tests run on mocked data (`fixtures/mock-snapshot-2025.json`) and an in-memory `MockChain` (`tests/bot_tests.rs`). Not yet run against the real programs in LiteSVM |
| zk proof of engine | — | — | ⬜ Not started. `methodology_image_id` is pinned per epoch, ready for it |
| Publishing (resolution URI) | — | — | ⬜ Not started. Bots take a `--resolution_uri`, but nothing uploads the snapshot and bundle |
| Market / API / web | `apps/` | — | ⬜ Later |

Verified on 2026-10-06: `cargo test -p eox-engine -p eox-oracle` passes 58 tests. The
on-chain tests need Anchor 1.2 and `anchor build --arch v0`, and were not re-run here.

## 3. Known gaps and risks

1. **The engine and ingestion don't agree on what they measure.** This is the main blocker.
   - Engine v0.1 universe: `CHN, DEU, GHA, NGA, USA`. Ingestion pilot: 30 OECD/BIS
     countries. Only `DEU` and `USA` are in both.
   - Engine v0.1 indicator IDs: `nighttime_lights`, `ndvi_crop_health`,
     `overnight_lending_rates`, `pmi`, `gdp_real_growth_yoy`, `cpi_headline_yoy`,
     `unemployment_rate`, `fiscal_deficit_gdp`.
   - Ingested IDs: `container_throughput`, `residential_property_price_real`,
     `gdp_real_volume`, `cpi_core_yoy`, `unemployment_rate`, `policy_rate`.
   - Today, only `unemployment_rate` flows end to end, for 2 countries. That is below the
     minimum of 3 indicators per country, so no country would get a score.
2. **The branches have diverged.** `feat/resolution-oracle` branched before all ingestion
   work (merge base `07691d7`). `main` is 53 commits ahead in ingestion, evidence-store and
   deploy. The exporter's `SnapshotObservation` doesn't carry `raw_value`, `recorded_at`
   or coverage.
3. **There are two clocks for "known by cutoff".** On `main`, `recorded_at` is stamped by
   the DB and can't be faked. `known_at` is the source's own claim. The exporter and engine
   currently filter on `known_at`. Pick one, because it decides what an honest watcher can
   reproduce.
4. **The bots are only tested against a mock chain.** Propose, watch and crank mirror the
   program's deadline checks by hand (`accepting_proposals`, `due`). The mock tests pin
   those copies to the documented windows, but only a LiteSVM run against the compiled
   programs proves they match what the program actually accepts.
5. **The resolution URI is a hash with nothing behind it.** Watchers need the proposer's
   published snapshot to name a `WrongObservation`. Without it, `watch` can only return
   `CannotVerify`, and a person has to step in.
6. **The deferred decisions from the evidence-store guide are still open** (section 5).

## 4. Next steps, in order

### Phase A: make the pipeline line up (blocker)
1. Merge `main` into `feat/resolution-oracle` and resolve the conflicts. Update
   `snapshot-exporter` to the new `Observation` shape and decide which of its fields go
   into the canonical leaf encoding.
2. Write a methodology **v0.2** that matches what ingestion actually produces: the
   indicator IDs, the polarity of each one, the weights, and the universe (the 30 pilot
   countries). Keep v0.1 so existing hashes can still be reproduced.
3. Decide the official source per country × indicator (`OfficialSources` map) and keep it
   versioned in the repo.
4. Add an end-to-end test: seed the evidence store, export as of the cutoff, run the
   engine, check that the root and hash are stable across runs.

### Phase B: harden the bots (runs on mocked data, doesn't wait on Phase A)
5. ✅ Mock-chain tests for `propose`, `watch` and `crank` on the mocked snapshot: happy
   path, wrong, extra and missing observations (the Merkle proof is checked with the
   program's own `is_member`), computation disputes, unverifiable claims, and every
   deadline edge.
6. Add a `LiteSvmChain` (the `Chain` trait over LiteSVM) and run the same scenarios against
   the compiled programs, including round 2 at 2× bond and the deadline boundary seconds.
   Needs `anchor build --arch v0`, so run it where the Solana toolchain is installed.
7. Add a long-running mode or cron wrapper, so watch and crank don't depend on someone
   running the CLI.

### Phase C: publishing and verification
8. Publish the snapshot and bundle at `resolution_uri` in a content-addressed store
   (IPFS/Arweave, or a bucket keyed by hash). The proposer uploads before proposing. The
   watcher fetches and checks against `evidence_root` before assessing.
9. Write a one-command "verify epoch Y" for outsiders: fetch the claim, fetch the URI,
   re-run the engine, compare.
10. Write a panel runbook: what members check for `MissingObservation` and `Computation`,
    and how `rationale_hash` gets published.

### Phase D: deploy
11. Deploy both programs to devnet. Pick the bond mint (USDC), bond size and panel members.
    Run `initialize`, `initialize_panel` and `open_epoch` for a test year with a shortened
    clock in a fork, or by waiting on devnet.
12. Run a full dry-run epoch with an honest proposer and a deliberately wrong claim.
13. Move the program upgrade authority to a multisig before mainnet.

### Phase E: proof layer
14. Run `eox-engine` in a zkVM. The engine does no I/O and is deterministic, so it fits.
    Set `methodology_image_id` to the guest image ID and verify the proof on-chain at
    proposal time. Then drop the `Computation` grounds.

## 5. Open decisions

| Decision | Options | Owner |
|---|---|---|
| Which vintage settles revised data | first release / value after fixed window / designated final vintage | team |
| Cutoff clock | `known_at` (source's claim) vs `recorded_at` (DB-stamped) | Joel + Godwin |
| Source precedence when two report the same thing | per-country official map (current exporter approach) | Godwin |
| v0.2 indicator set, weights and polarity | from ingestion's 6, plus whatever is added next | Godwin + Peter |
| Bond size and mint, panel membership | — | team |
| Where resolution bundles are published | IPFS / Arweave / bucket | team |
| Who may set `knownAt` manually | restrict to backfill scripts | Joel |

## 6. How to run what exists

```bash
# data side (main)
pnpm install && pnpm db:up && pnpm db:migrate
pnpm --filter @eox/ingestion ingest:container-throughput

# engine + bots (feat/resolution-oracle)
cargo test -p eox-engine -p eox-oracle
# dry run the engine on mocked data
cargo run -p eox-oracle -- run-engine -s packages/apps/eox-oracle/fixtures/mock-snapshot-2025.json \
  -e epoch_2025 -m 0202020202020202020202020202020202020202020202020202020202020202
cargo run -p eox-oracle -- run-engine -s snapshot.json -e epoch_2025 -m <64-hex image id>

# programs
cd packages/apps/onchain && anchor build --arch v0 && cargo test
```

Keep this file up to date: tick off steps as they land, and record decisions in section 5
when they're made.
