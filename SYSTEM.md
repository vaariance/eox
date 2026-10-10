# COX system contract

Version 2.3 · 10 October 2026 · **status: proposed, awaiting sign-off.**

Version 2.3 adds Coinbase and Bybit as fallback venues used only when Kraken's
cutoff minute is empty (§3.2), moves all venue access into a separate
rate-limited package owned by Joel (§10.1), and puts every price on one fixed
USD scale (§5.2). Version 2.2 replaced Pyth with Kraken's public one-minute candles as the only
price source, replaces 13 older assets with newer ones (§4.1), and makes the
publisher's key the attestation of each snapshot (§5.2, §6.3). Version 2.1
expanded the roster to 30 assets. Version 2 replaced the EOX contract (version
1, drafted 2026-10-08 by Joel) with the contract for COX, the Crypto Outlook
Index.

The product source is `docs/cox/cox-paper-3.md` (COX Paper 3, v0.1). The work
assignments, and what each person preserves, carries over or deletes, are in
`product.md`. Earlier versions are in git history; nothing in them binds COX
work unless this file repeats it.

This file pins the decisions every package must agree on: clocks, data types,
storage, identities, the publication cycle, the reference and pool arithmetic
boundaries, failure behaviour and operations.

It is **versioned, not append-only**: change it only by bumping the version,
getting sign-off from the owners named in the change, and appending an
`AGENTS.md` entry that says what changed.

| Status | Meaning |
|---|---|
| **PINNED** | A COX Paper 3 product commitment, or infrastructure that exists today and is carried into COX unchanged. Changing it breaks another package or the product. |
| **PROPOSED** | MVP choice made in this version. Needs the named owner's sign-off before it is relied on outside devnet. |
| **OPEN** | Undecided. The named owner decides; no package may assume an answer. |

## 1. Owners

| Area | Owner | Folders (target layout) |
|---|---|---|
| Price evidence: `price-feeds` venue package, archiver, evidence store, evidence API, dev operations, signing service, app API and client | Joel | `packages/price-feeds`, `packages/ingestion`, `packages/evidence-store`, `apps/evidence-api`, `apps/signer`, `packages/signing`, `apps/app-api`, `packages/app-api`, `deploy/` |
| Methodology, mechanism specification, COX math, the `cox` Solana program, publisher | Peter | `packages/cox-methodology`, `packages/cox` (Rust workspace: `crates/math`, `crates/cli`, `programs/cox`), `apps/cox-publisher` |
| Independent monitor and trading UI | Godwin | `apps/cox-monitor`, `apps/web` |

The EOX folders that `product.md` marks for deletion (`packages/oracle`,
`packages/methodology`, `packages/optimistic-oracle`, `apps/oracle-worker`,
`apps/uma-relay`) are not part of COX. Do not add COX code to them.

## 2. The system in one path

COX Paper 3 §14 separates the external price world from two deterministic
engines (reference and collateral) and a ledger. Each boundary must be
independently reproducible.

```text
Kraken (WebSocket ohlc, REST repair) · Coinbase (REST) · Bybit (REST)   external
  │ price-feeds package: venue adapters, rate limiters,
  │ fallback chain Kraken → Coinbase → Bybit                 [Joel]
  ▼
archiver: resolve each asset's cutoff price, store raw bytes,
  decode, check admissibility                                [Joel]
  ▼
evidence store (Postgres, append-only) → evidence API          [Joel]
  │ publisher reads the archived snapshot for the cutoff and
  │ submits it, signed by the oracle-operator key             [Peter]
  ▼
cox program (Solana devnet)                                    [Peter]
  1 close batch k at its cutoff
  2 check the snapshot against the manifest and the signer
  3 reference engine: CRYPTO level, asset references
  4 collateral engine: revalue existing claim classes
  5 execute batch k requests at the post-revaluation unit values
  6 commit publication k (predecessor-linked, atomic to users)
  │
  ├──► cox-monitor: re-fetch venues, recompute every publication [Godwin]
  └──► app API: indexer, quotes, unsigned transactions          [Joel]
          ▼
       web app: wallet-signed requests, portfolio, status      [Godwin]
```

There is no UMA assertion, no challenge window, no EVM chain, no Wormhole and
no third-party oracle in this path (Paper 3 §2, §6, §16). Venue access goes
only through `packages/price-feeds`; no other package calls an exchange.

**Trust statement — PINNED for this version.** No venue signs its data, so the
program cannot verify that a price came from Kraken, Coinbase or Bybit. The program
accepts a snapshot only from the `oracle-operator` key and checks everything it
can check deterministically (§5.2). Authenticity is established after the fact:
every candle is publicly re-fetchable from its venue, and the monitor compares
each publication with the venue and with the archive. This is acceptable only
because the MVP runs on devnet with a test collateral token. Real collateral
requires an independently authenticated source (§12).

## 3. Time

COX has four clocks. Name which one a timing belongs to; never mix them.

### 3.1 Source clock — PINNED

Each venue aggregates its own trades into one-minute candles. A candle starting
at `t` covers trades in `[t, t + 60)`; its close is the venue's last trade at or
before `t + 60`. Venues mark an empty minute differently (measured 2026-10-10):

| Venue | Empty minute | Trade evidence | Final when |
|---|---|---|---|
| Kraken REST `OHLC` | returned with `count = 0`, prices = previous close | `count` | `time ≤ last` in the response |
| Kraken WebSocket v2 `ohlc` | no update is pushed (updates are sent on trades) | `trades` | the next minute has begun and the connection had no gap |
| Coinbase `/products/{id}/candles` | omitted | candle present with `volume > 0` | fetched at least 5 s after the minute ends |
| Bybit `/v5/market/kline` (spot) | returned with volume 0 | `volume > 0` | its start is before the latest candle's start |

COX never treats archive time, submission time or slot time as a price's
observation time.

### 3.2 Batch clock — PINNED cadence, PROPOSED offsets (Peter)

| Item | Value |
|---|---|
| Cadence | one minute (Paper 3 §7) |
| Cutoff of batch `k` | `cutoff_k = origin + 60·k`, UTC minute boundary |
| Request admission | a request belongs to the first batch whose cutoff is strictly after the on-chain `Clock::unix_timestamp` of its submission |
| Cancellation | allowed only while its batch is open (before the cutoff); never after |
| Cutoff candle | the candle starting at `cutoff_k − 60` |
| Price of asset `i` for batch `k` | rule `COX/PRICE-FALLBACK/V1` below |
| Trade age | 0 when a venue's cutoff candle has trades; otherwise minutes from the end of Kraken's last candle with trades to `cutoff_k` |
| Maximum trade age | 30 minutes; above it the asset is inadmissible (§9) |
| Archive deadline | every asset resolved and archived by `cutoff_k + 30 s` |

**`COX/PRICE-FALLBACK/V1` — PROPOSED (Peter, implemented by Joel).** For each
asset, walk the venues in the fixed order Kraken → Coinbase → Bybit, skipping
venues that do not list the asset (§4.1):

1. Kraken's cutoff candle has trades → its close. Coinbase and Bybit are not
   queried for that asset.
2. Otherwise Coinbase's cutoff candle has trades → its close.
3. Otherwise Bybit's cutoff candle has trades → its close converted to USD with
   the USDT/USD price resolved for the same cutoff by steps 1–2 on Kraken
   `USDT/USD` then Coinbase `USDT-USD`. If no USDT/USD price has trades in the
   cutoff minute, step 3 is skipped.
4. Otherwise Kraken's carried close (its last trade before the cutoff) with its
   trade age.

A venue that is unreachable, rate-limited past the archive deadline or returns
a malformed response counts as "no trades" for that step and is recorded as
an incident with its reason. Fallback is per asset and per minute: no venue's
price is averaged with another's. Every price records the venue and step that
produced it.

Requests bind before their execution prices exist; prices are observed only
after the cutoff (Paper 3 §7–8). The candle and the venue order are fixed in
advance, so there is no selection window.

Known effect: when the source venue changes between two cutoffs, the return
includes the price difference between venues (usually a few basis points). It
is not smoothed or corrected; the app shows the venue next to each price.

### 3.3 Publication clock — PROPOSED (Peter)

| Item | Value |
|---|---|
| Publication `k` | revaluation and execution for batch `k`, committed in program state |
| Commit deadline | `cutoff_k + 55 s`; after it, batch `k` cannot publish and its requests roll to batch `k+1` unless expired |
| Missed batch | no publication; the next valid publication spans the elapsed interval (Paper 3 §3) |
| Delayed status | no publication for 3 consecutive cutoffs |
| Halted status | no publication for 60 consecutive cutoffs (§9) |

### 3.4 Methodology clock — PINNED

Methodology versions activate prospectively at a declared future batch
sequence. There is no epoch expiry, annual cutoff or terminal maturity for
positions (Paper 3 §13, §15). The EOX settlement clock (31 July cutoff, 72 h
liveness, 35-day void) does not exist in COX.

## 4. Universe and benchmark

### 4.1 MVP roster — PROPOSED (Peter, data check by Joel)

Thirty assets. Every asset has a Kraken USD pair (primary venue); fallbacks
are Coinbase `<ASSET>-USD` and Bybit spot `<ASSET>USDT` where listed. Listings
were read from Kraken `/0/public/AssetPairs`, Coinbase `/products` and Bybit
`/v5/market/instruments-info` on 2026-10-10. The order below is the canonical
asset order used by the manifest, the program and the vectors.

| # | Asset id | Name | Kraken (WebSocket symbol / REST pair) | Coinbase | Bybit |
|---|---|---|---|---|---|
| 0 | `BTC` | Bitcoin | `BTC/USD` / `XXBTZUSD` | `BTC-USD` | `BTCUSDT` |
| 1 | `ETH` | Ethereum | `ETH/USD` / `XETHZUSD` | `ETH-USD` | `ETHUSDT` |
| 2 | `SOL` | Solana | `SOL/USD` / `SOLUSD` | `SOL-USD` | `SOLUSDT` |
| 3 | `XRP` | XRP | `XRP/USD` / `XXRPZUSD` | `XRP-USD` | `XRPUSDT` |
| 4 | `BNB` | BNB | `BNB/USD` / `BNBUSD` | `BNB-USD` | `BNBUSDT` |
| 5 | `TRX` | Tron | `TRX/USD` / `TRXUSD` | — | `TRXUSDT` |
| 6 | `AVAX` | Avalanche | `AVAX/USD` / `AVAXUSD` | `AVAX-USD` | `AVAXUSDT` |
| 7 | `DOT` | Polkadot | `DOT/USD` / `DOTUSD` | `DOT-USD` | `DOTUSDT` |
| 8 | `NEAR` | NEAR Protocol | `NEAR/USD` / `NEARUSD` | `NEAR-USD` | `NEARUSDT` |
| 9 | `SUI` | Sui | `SUI/USD` / `SUIUSD` | `SUI-USD` | `SUIUSDT` |
| 10 | `APT` | Aptos | `APT/USD` / `APTUSD` | `APT-USD` | `APTUSDT` |
| 11 | `UNI` | Uniswap | `UNI/USD` / `UNIUSD` | `UNI-USD` | `UNIUSDT` |
| 12 | `ARB` | Arbitrum | `ARB/USD` / `ARBUSD` | `ARB-USD` | `ARBUSDT` |
| 13 | `OP` | Optimism | `OP/USD` / `OPUSD` | `OP-USD` | `OPUSDT` |
| 14 | `INJ` | Injective | `INJ/USD` / `INJUSD` | `INJ-USD` | `INJUSDT` |
| 15 | `AAVE` | Aave | `AAVE/USD` / `AAVEUSD` | `AAVE-USD` | `AAVEUSDT` |
| 16 | `ZEC` | Zcash | `ZEC/USD` / `XZECZUSD` | `ZEC-USD` | — |
| 17 | `STRK` | Starknet | `STRK/USD` / `STRKUSD` | `STRK-USD` | `STRKUSDT` |
| 18 | `HYPE` | Hyperliquid | `HYPE/USD` / `HYPEUSD` | `HYPE-USD` | `HYPEUSDT` |
| 19 | `TAO` | Bittensor | `TAO/USD` / `TAOUSD` | `TAO-USD` | — |
| 20 | `WLD` | Worldcoin | `WLD/USD` / `WLDUSD` | `WLD-USD` | `WLDUSDT` |
| 21 | `ONDO` | Ondo | `ONDO/USD` / `ONDOUSD` | `ONDO-USD` | `ONDOUSDT` |
| 22 | `ENA` | Ethena | `ENA/USD` / `ENAUSD` | `ENA-USD` | `ENAUSDT` |
| 23 | `ZRO` | LayerZero | `ZRO/USD` / `ZROUSD` | `ZRO-USD` | `ZROUSDT` |
| 24 | `FET` | Artificial Superintelligence Alliance | `FET/USD` / `FETUSD` | `FET-USD` | `FETUSDT` |
| 25 | `JUP` | Jupiter | `JUP/USD` / `JUPUSD` | — | `JUPUSDT` |
| 26 | `AERO` | Aerodrome | `AERO/USD` / `AEROUSD` | `AERO-USD` | `AEROUSDT` |
| 27 | `RENDER` | Render | `RENDER/USD` / `RENDERUSD` | `RENDER-USD` | `RENDERUSDT` |
| 28 | `TIA` | Celestia | `TIA/USD` / `TIAUSD` | `TIA-USD` | `TIAUSDT` |
| 29 | `W` | Wormhole | `W/USD` / `WUSD` | `W-USD` | `WUSDT` |

USDT/USD conversion for Bybit uses Kraken `USDT/USD` (`USDTZUSD`), then
Coinbase `USDT-USD`.

Selection: Peter asked for newer tokens and removed DOGE, ADA, LINK, LTC, TON,
BCH, XLM, ATOM, HBAR, ETC, FIL, XMR and ICP. The 13 replacements (rows 17–29)
are the most-traded non-stablecoin tokens launched in recent cycles among
Kraken's USD pairs, by Kraken 24-hour USD volume on 2026-10-10. `STRK` is
Starknet's token; Peter confirms it is the "STARK" of Paper 3 §1.

Exclusions (Paper 3 §4, duplicate exposure):

- **Stablecoins and other pegged tokens:** fiat-pegged tokens (USDT, USDC, DAI,
  PYUSD, USDe and similar) and commodity-backed tokens (PAXG, XAUT). Their
  price performance is the peg, not a crypto outlook. `ENA` is Ethena's
  governance token, not its stablecoin, and is not excluded.
- **Wrapped, bridged and liquid-staking derivatives** of a listed asset (WBTC,
  cbBTC, stETH, wstETH, JitoSOL, mSOL and similar): they duplicate the
  underlying's exposure inside CRYPTO.

Liquidity, measured over 300 closed minutes on 2026-10-10: minutes with no
Kraken trade, and minutes still without a trade after the Coinbase and Bybit
fallbacks.

| Asset | Kraken empty | After fallback | Asset | Kraken empty | After fallback |
|---|---|---|---|---|---|
| BTC, ETH, SOL, XRP, AVAX | 0 | 0 | ZEC | 15 | 0 |
| BNB | 84 | 0 | STRK | 3 | 0 |
| TRX | 25 | 0 | HYPE | 22 | 0 |
| DOT | 39 | 1 | TAO | 57 | 9 |
| NEAR | 1 | 0 | WLD | 27 | 0 |
| SUI | 5 | 0 | ONDO | 68 | 0 |
| APT | 140 | 0 | ENA | 74 | 0 |
| UNI | 36 | 0 | ZRO | 78 | 0 |
| ARB | 108 | 1 | FET | 42 | 3 |
| OP | 101 | 3 | JUP | 103 | 3 |
| INJ | 83 | 0 | AERO | 84 | 0 |
| AAVE | 120 | 3 | RENDER | 114 | 31 |
| TIA | 2 | 0 | W | 76 | 4 |

Across all 30 assets, about 5 assets per minute need a fallback and 0.6% of
asset-minutes remain without a trade. Those use Kraken's carried close and
trade age (§3.2 step 4); RENDER is the weakest. TRX and JUP depend on Bybit as
their only fallback; ZEC and TAO on Coinbase.

Admission: every listed asset must pass Joel's feed check (product.md J1)
before Peter seals the manifest. An asset that fails is removed and not
substituted, and the roster size `N` in every label is the number actually
sealed. Replacing or adding an asset after sealing requires a new methodology
version (§3.4).

An asset is identified by its asset id **and** its venue symbols in this table;
a ticker alone is never an identity. Quote currency is USD. The benchmark roster equals
the tradable roster (Paper 3 §4 boundary case); the pilot benchmark is labelled
`CRYPTO (pilot, N assets)` everywhere it is shown.

### 4.2 CRYPTO — PROPOSED (Peter)

Equal weights `w = 1/N`, re-applied at every publication (constant equal
weights). Chain-linked:

```text
B_k = B_{k-1} · Σ_i w · (P_i,k / P_i,k-1)          B_origin = 100
```

A missed publication is a **rebalance freeze**: the next publication links one
step over the elapsed interval with the weights in force at the last
publication. This is the predefined outage policy Paper 3 §4 requires; no
intermediate prices are reconstructed or invented.

### 4.3 COX reference — PINNED (Paper 3 §3)

```text
A_i,k = P_i,k / P_i,origin      W_k = B_k / B_origin      Q_i,k = 100 · A_i,k / W_k
```

Sensitivity is 1x. 100 is a display base. Ratio-relative change, never
percentage-point subtraction. Prices are price return only: no staking, yield or
airdrops.

## 5. Data types and storage

### 5.1 Evidence store — PINNED machinery, PROPOSED COX schema (Joel)

Carried over unchanged from EOX: Postgres 16; `source_payloads` holds every
response byte-for-byte with a database-checked SHA-256; append-only triggers;
`recorded_at` stamped by the database; transaction-ID change feed (migration
`007`); daily verified backups to `gs://colosseum-eox-db-backups`.

New COX tables (new migrations; EOX tables stay as a read-only archive with no
writers):

| Table | Key columns |
|---|---|
| `assets` | `asset_id`, `position`, `kraken_ws_symbol`, `kraken_rest_pair`, `coinbase_product` (nullable), `bybit_symbol` (nullable) |
| `venue_responses` | one row per archived venue response: `venue`, `asset_id` (or `USDT`), `cutoff`, `request` (method, URL or subscription), `raw_sha256` → `source_payloads`, `recorded_at`; WebSocket evidence is the ordered frames for that candle |
| `venue_attempts` | every fallback step tried: `asset_id`, `cutoff`, `venue`, `step`, `outcome` (`trades`, `empty`, `not-listed`, `unavailable`, `rate-limited`, `malformed`), `raw_sha256` (nullable) |
| `price_observations` | `asset_id`, `cutoff`, `venue`, `step`, `candle_start`, `close` (source text), `usdt_usd` (source text, Bybit only), `price_e8` (integer text, USD × 10⁸), `trade_evidence` (count or volume text), `trade_age_minutes`, `raw_sha256`, `recorded_at`, `admissible`, `rejection` |
| `snapshots` | `cutoff`, ordered `price_observations` ids, `snapshot_digest`, `admissible`, `recorded_at` |
| `incidents` | `cutoff`, `kind`, `detail`, `raw_sha256` (nullable), `recorded_at` |

Rules: source strings stored exactly as received; for Kraken and Coinbase,
`price_e8` is an exact decimal-to-integer conversion and a close with more than
8 decimals is inadmissible; for Bybit, `price_e8 = round_half_away(close ×
usdt_usd × 10⁸)`, the one named conversion (`COX/USDT-USD/V1`), with both
inputs stored; a rejected observation is recorded
with its reason, never replaced by a substitute (Paper 3 §6).

### 5.2 Prices on chain — PROPOSED (Peter)

`publish(k, prices, trade_ages, snapshot_digest)` is signed by the
`oracle-operator` runtime authority and carries the 30 prices as integers in USD × 10⁸,
each with its venue code and trade age, in canonical order. The program checks: signer is
the runtime authority; `k` is the next sequence and its cutoff has passed; the
array length and order match the manifest; every price is positive; every
trade age is within the bound; and `snapshot_digest` equals the digest of the
submitted values (§6.1). All prices share the one scale, so ratios need no
rescaling. Thirty prices fit
in one transaction; no staging pages or lookup tables are needed. The program
does not and cannot check that the prices equal the venues' (§2 trust statement).

### 5.3 Arithmetic — PROPOSED (Peter)

- Reference arithmetic: checked integer arithmetic in `i128`, reference values
  stored at scale 10¹², nearest rounding with ties away from zero (carried over
  from `eox-oracle-math`).
- Claim arithmetic: collateral amounts in the collateral token's base units
  (`u64`); units in `u128` at scale 10¹². Mint and redemption round **down**
  for the user; every residual goes to a named `residual` ledger line owned by
  the pool, never redistributed and never taken by the operator.
- One Rust crate (`packages/cox/crates/math`) defines both. The program, the
  CLI and the published vectors use it. The monitor reimplements it
  independently in TypeScript and must match the vectors byte for byte.

### 5.4 Durability — PINNED / PROPOSED

- Evidence: Postgres on the dev VM, append-only, daily backups (PINNED).
- Chain: the authoritative record of publications, requests, positions and the
  ledger (PINNED).
- Publisher: filesystem journal plus PID lock, one writer (carried over from
  the oracle worker; PROPOSED for COX).

## 6. Identities and the publication

### 6.1 Identities — never substitute one for another

| Identity | Definition | Status |
|---|---|---|
| Asset identity | `(asset_id, venue symbols in §4.1)` | PROPOSED |
| Artifact digest | SHA-256 of a raw venue response | PINNED |
| Price digest | SHA-256 over domain `COX/PRICE/V1` of `(asset_id, venue, step, candle_start, price_e8, trade_age_minutes)` | PROPOSED |
| Snapshot digest | SHA-256 over domain `COX/SNAPSHOT/V1` of the cutoff and the ordered price digests | PROPOSED |
| Methodology manifest digest | SHA-256 of the canonical `COX/METHODOLOGY/V1` manifest | PROPOSED |
| Publication identity | `(program, pool, sequence)`; links its predecessor's sequence and state digest | PROPOSED |
| Request identity | request account address; carries owner, batch, operation, amounts, conditions | PROPOSED |

### 6.2 What a publication binds — PROPOSED (Peter)

Sequence, batch cutoff, predecessor, methodology manifest digest, snapshot
digest, each asset's price, venue, fallback step and trade age, CRYPTO level, each COX reference,
each class's pre-flow and post-flow backing and units, executed and rejected
request counts, and the resulting ledger totals. A publication cannot be
replayed as a new interval; sequence and predecessor enforce it.

### 6.3 Snapshot selection and attestation — PROPOSED (Peter, Joel, Godwin)

The candle and venue order for each asset are fixed by the cutoff and §3.2, so
the operator has no choice of observation. The archiver archives every
response before the publisher may use it; the publisher submits exactly the
archived snapshot. The monitor re-fetches candles in bulk from each venue
(Kraken REST returns 720 one-minute candles per call, about 12 hours; Coinbase
300; Bybit up to 1,000) through its own rate-limited `price-feeds` client, and
checks for every publication that each step's outcome and the chosen close
match. Any difference is an incident (§9). A venue can revise a final candle;
a revision after publication is recorded as an incident and never changes a
committed publication (Paper 3 §6).

## 7. Collateral engine

### 7.1 Claim classes — PROPOSED (Peter)

One class per listed asset plus one `CRYPTO` class: 31 classes for the full
30-asset roster, stored in one pool account. Unallocated collateral does not
exist inside the pool: a deposit is pending (owned by its depositor) until it
executes into a class.

### 7.2 Transfer rule `COX/TRANSFER/MVP-0` — PROPOSED (Peter), test assets only

```text
h_i = (P_i,k / P_i,k-1) / (B_k / B_k-1)        h_CRYPTO = 1
V_i' = C · V_i · h_i / Σ_j V_j · h_j
```

This is the illustrative rule of Paper 3 §10, with a CRYPTO class providing the
benchmark-growth comparison side. Known property: the benchmark factor cancels,
so asset classes compete on asset returns and CRYPTO-class holders on the
benchmark return. **It is not the production mechanism.** Paper 3 leaves the
transfer rule open; MVP-0 exists so the devnet product can run end to end on a
test token. Real collateral is blocked until a rule is selected under §12.

### 7.3 Units and flows — PINNED identities (Paper 3 §11), PROPOSED edge rules (Peter)

```text
p_i = V_i / U_i         minted = floor(d / p_i)        proceeds = floor(x · p_i)
```

Order inside a publication: revalue existing classes → fix every `p_i` → execute
all batch requests at those fixed `p_i` → commit. Request processing order
cannot change any outcome. A switch is a redemption and a deposit at the same
fixed `p`. Edge rules: an empty class bootstraps at `p = 1` (scaled); a class
with units and zero value accepts no deposits; zero or negative prices make the
snapshot inadmissible (§9); fees are zero in the MVP.

### 7.4 Custody categories — PINNED (Paper 3 §9, §11)

The vault balance must always equal the sum of: active backing `C`, pending
deposits, withdrawal payables and the residual line. No category funds another.
The program asserts this equality at the end of every instruction that moves
value.

## 8. Requests

PROPOSED (Peter):

| Operation | Reserved at submission | Condition fixed in advance |
|---|---|---|
| `deposit(class, amount)` | tokens move into the vault as a pending deposit | `min_units`, `expiry_batch` |
| `switch(from, to, units)` | source units locked; stay exposed until revaluation | `min_units_out`, `expiry_batch` |
| `redeem(class, units)` | units locked; stay exposed until revaluation | `min_proceeds`, `expiry_batch` |
| `withdraw()` | — | pays the caller's withdrawal payable |

A request whose condition fails is rejected at execution with its reservation
returned (deposit back to pending refund, units unlocked). An expired request is
rejected the same way. A new request from the same owner for the same source
units is rejected while one is pending.

## 9. Failure, incidents and governance

PROPOSED (Peter):

- **Inadmissible snapshot** (any asset unresolved by the archive deadline,
  close not positive, more than 8 decimals at Kraken or Coinbase, trade age
  above the bound, Kraken pair renamed or delisted): no publication for that batch;
  Joel records an incident; requests roll forward until expiry. The last
  accepted reference stays readable with its age and is never executed against
  (Paper 3 §15).
- **Delayed** (3 missed cutoffs): the app shows delayed; nothing changes on chain.
- **Halted** (60 missed cutoffs): the program accepts only cancellation of
  pending requests and refund of pending deposits. Positions stay frozen; no
  redemption at a stale value. Resumption is the next valid publication over the
  elapsed interval.
- **Monitor mismatch** (publication differs from the archive or from Kraken):
  the monitor reports; a human with the admin authority pauses. The monitor
  holds no key.
- **Admin authority:** pause, activate a future methodology version, rotate the
  runtime publisher key. It cannot set prices, references, class values or
  balances, and cannot rewrite a committed publication or withdrawal.

Known MVP weakness: a user who sees other venues move before Kraken, Coinbase
or Bybit trades a thin asset can anticipate its next price. On test collateral this is
accepted and disclosed in the app; it is one reason real collateral needs a
multi-venue, authenticated source (§12).

## 10. Operations

| Component | Runs | Owner |
|---|---|---|
| Postgres, backups | dev VM `eox-dev`, GCP `colosseum-eox` (PINNED) | Joel |
| Archiver (uses `price-feeds`) | same VM, systemd, continuous per-minute loop (PROPOSED) | Joel |
| Evidence API | same VM, `127.0.0.1:8787` (PINNED host, new COX routes) | Joel |
| Signing service | Cloud Run `eox-signer`, KMS `eox-signing-dev` (PINNED) | Joel |
| `cox` program | Solana devnet (PROPOSED) | Peter |
| Publisher | same VM, systemd, journal on persistent disk (PROPOSED) | Peter |
| Monitor | same VM, systemd (PROPOSED) | Godwin |
| App API | same VM; fixture and live origins (PINNED pattern) | Joel |
| Web app | static hosting (OPEN, Godwin) | Godwin |

Testnet: Solana devnet only. Collateral: a devnet SPL test token minted by the
deployment; real USDC is out of scope (§12).

### 10.1 Venue access and rate limits — PROPOSED (Joel)

All exchange traffic goes through `packages/price-feeds`. Each venue has one
limiter per process, shared by every caller in that process, set to at most
half the venue's published public limit:

| Venue | Published public limit | COX budget | Normal COX load |
|---|---|---|---|
| Kraken WebSocket v2 | — | 1 connection, 1 subscription for all symbols; reconnect backoff 1 s doubling to 60 s with jitter | continuous |
| Kraken REST | ~1 request/s per IP (Kraken's recommended gap for `OHLC`) | 1 request per 2 s | gap repair only, after a WebSocket disconnect |
| Coinbase REST | 10 requests/s per IP, burst 15 | 2 requests/s | about 5 per minute (Kraken-empty assets) |
| Bybit REST | 600 requests per 5 s per IP | 2 requests/s | about 2 per minute (still-empty assets) |

Rules: requests to one venue are sequential (concurrency 1); `429`, Kraken
`EAPI:Rate limit exceeded` and Bybit rate-limit codes trigger exponential
backoff with jitter, honouring `Retry-After` when sent; five consecutive
failures open a circuit breaker for that venue for 60 s, during which its steps
count as `unavailable`; identical requests within one minute are served from a
cache, never re-sent; fallback venues are queried only for assets that need
them; every request carries a `User-Agent` naming COX and a contact address.
The monitor runs its own process and budget, at most one quarter of each
venue's published limit, and uses bulk historical calls (one call per asset per
venue covers hours) rather than per-minute calls.

Bybit access: Bybit excludes users in the United States and some other
jurisdictions and is reported to block US and cloud IP ranges. The dev VM runs
in a US region. Bybit is used only if Joel confirms that the VM reaches
`api.bybit.com` and that Bybit's terms permit the team's use. No proxy or VPN is
used to get around a block. Without Bybit, TRX and JUP have no fallback and use
Kraken alone.

## 11. Rules for every agent

1. Read this file, `product.md`, `AGENTS.md` and COX Paper 3 before working.
2. Never invent a price, timestamp or substitute observation. Rejected inputs
   are recorded incidents. A Kraken empty-minute candle is Kraken's last trade
   price, not a COX-filled value; record its trade count and age.
   Never average venues or choose a venue other than by §3.2.
3. Never execute a request at a valuation that existed before its batch's
   cutoff, and never let processing order change an outcome.
4. Never mix the clocks in §3 or substitute one identity in §6.1 for another.
5. Never let confidence, quality or price uncertainty scale a return; quality
   only admits or rejects (Paper 3 §6).
6. Never present MVP-0 as the production mechanism, a reference as a payout,
   the pilot CRYPTO as the whole crypto market, or operator-attested exchange
   prices as independently verified.
7. Never call an exchange except through `packages/price-feeds`, and never
   raise a venue budget above half its published limit.
8. Never rewrite evidence or committed publications. Corrections are new
   records.
9. Fetch and rebase before pushing; `main` is shared.
10. A PROPOSED or OPEN item is not a decision outside devnet.

## 12. Open before real collateral

| Item | Owner |
|---|---|
| Independently authenticated, multi-venue price source replacing operator-attested exchange candles | Peter, Joel |
| Production transfer rule replacing MVP-0, with the Paper 3 §17 simulations | Peter |
| Benchmark weight schedule, eligibility, liquidity and concentration policy | Peter |
| Fees, residual ownership and operational reserves | Peter |
| Collateral asset, custody and legal structure | Peter |
| Kraken, Coinbase and Bybit data terms for commercial display and archival; Bybit jurisdiction | Joel |

## 13. Sign-off

| Section | Needs | Signed |
|---|---|---|
| §2 trust statement | Peter | |
| §3.2–3.3 batch, fallback price rule and publication timing | Peter, Joel | |
| §4.1 MVP roster (30 assets, exclusions) | Peter, Joel | |
| §4.2 CRYPTO construction | Peter | |
| §5.1 COX evidence schema | Joel | |
| §10.1 venue access and rate limits | Joel, Godwin (monitor) | |
| §5.2–5.3 on-chain prices and arithmetic | Peter, Godwin (monitor) | |
| §6.3 snapshot selection and attestation | Peter, Joel, Godwin | |
| §7 transfer rule MVP-0 and units | Peter | |
| §8 requests | Peter, Joel (builders), Godwin (UI) | |
| §9 failure and governance | Peter | |
