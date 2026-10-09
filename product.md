# EOX product direction

Version 7 · 9 October 2026 · Signing, trading app and ordered execution plan

This document explains what EOX should do for its users and how the three
developers' work must connect. It records Peter's product direction and pins the implementation rules in
section 8. It does not claim that the complete product is
already implemented or that the team has signed off this document.

This is the product brief for implementing v1; section 8 replaces its earlier
open-decision list. These are requirements, not claims about deployed behavior. `SYSTEM.md` remains the
separate engineering contract and has not been changed. Its annual settlement
flow and older timing proposals must not determine this release's behavior.
Peter owns their follow-up alignment through the engineering contract's
documented change process. This edit leaves that file unchanged.

## 1. What EOX is

EOX lets people trade the relative economic performance of countries.
WORLD is the common benchmark, built from the countries in the chosen EOX
methodology. A country can improve economically and still underperform WORLD
or another country.

The trading interface can show a pair such as US/JP. Underneath, both countries
have a reference against WORLD. Comparing those references gives US against
JP; WORLD cancels from that comparison. An update to a third country can move
US/WORLD without moving US/JP when the US and Japan indices are unchanged.

The product keeps three things visible and separate:

- **Economic reference:** the result calculated from accepted evidence under
  published rules.
- **Confidence:** how much trust the evidence deserves, including its quality,
  age and dispute history.
- **Trade and account value:** what the exchange allows a user to buy, sell or
  redeem under its collateral and pricing rules.

An EOX reference is an index, not a dollar balance. The EOX-20 multiplier
amplifies the defined relative index movement; it does not by itself promise
20-times leverage or a corresponding USDC payout.

## 2. The experience we want

Users should be able to enter and exit continuously using the latest accepted
on-chain reference. New evidence being processed or challenged does not, by
itself, stop trading against that reference.

There is no routine wait for the next evidence batch before executing a trade,
and no annual wait imposed by the oracle before a user can exit. Trading can
start only after the first complete reference and baseline have been accepted.

The intended exit route is from a country exposure through WORLD into USDC.
The exchange must remain fully collateralized: its redeemable obligations must
be covered by its collateral. Section 8 pins the collateral and launch boundary: the first integrated
release uses test funds, and a complete exchange accounting specification is
required before real-money trading. Calling WORLD
the benchmark does not automatically make it a USDC-backed redeemable asset.

For the initial devnet pool, Peter has accepted execution at the latest
finalized oracle reference. Someone who calculates an incoming update early
may gain an advantage. This is an accepted devnet limitation, not a problem
solved by confidence scores, timestamps or restricting access to our client.

## 3. How a new reference reaches the product

```text
Fetch data → preserve evidence → apply methodology → freeze and pre-commit
    → one-hour challenge window → resolve and confirm the outcome
    → post-commit → calculate and publish on Solana → use the new reference

Throughout this process, trading uses the previous accepted reference.
```

1. **Fetch and store.** Check supported sources at least hourly, subject to
   source availability. Preserve the original response, exact values, source,
   period and any stated publication time. Store corrections as new records.
2. **Prepare the next snapshot.** At an hourly cutoff, select the evidence under
   the agreed methodology. Carry forward accepted observations where no
   replacement exists. Missing data must never become invented values.
3. **Pre-commit.** Freeze the exact evidence and rules for this proposal. Make
   the evidence and explanation available to challengers. New arrivals belong
   to a later proposal and cannot change this one.
4. **Assert and allow challenges.** Open a one-hour challenge window through
   the UMA integration. The full hour starts when the assertion is challengeable
   and its supporting evidence is available, not when fetching started.
5. **Confirm the outcome.** If nobody disputes it, settle the assertion after
   the window and deliver authenticated confirmation to Solana. A local timer
   alone cannot approve the proposal.
6. **Post-commit and publish.** Bind the frozen evidence to the confirmed
   challenge outcome. Solana calculates and publishes the complete new
   reference together with its confidence and version. Only then does it
   become the reference used for new trades.

This is a repeating process. Annual assertions are not a required stage in
this continuous product. Any future annual instrument needs its own explicit
product brief and must not impose its schedule on ordinary trading or exits.

### Example timing

| Time | What happens |
| --- | --- |
| Before 10:00 | Data is collected and prepared for the next hourly snapshot. |
| 10:00 | The snapshot is frozen; assume its assertion and evidence become available immediately. |
| 10:00–11:00 | Anyone eligible under the dispute mechanism can challenge. Users trade against the previous accepted reference. |
| Shortly after 11:00 | If undisputed, settlement, relay and Solana publication make the new reference usable. |

Network or processing delays add time. A disputed proposal can take longer
than one hour. The hourly cadence is a processing target, not a promise that
new economic information or a new accepted reference exists every hour.

An hourly check also does not turn quarterly GDP into hourly GDP. Every
observation retains its original economic period. Regular snapshots make
reference timing more predictable; they do not guarantee smooth candles.
The app must distinguish reference history from actual trading candles.

## 4. What happens when something is challenged

A challenge must identify the exact proposal and evidence being contested.
Duplicate delivery must not count as another challenge.

- **While unresolved:** the proposed reference stays pending. The previous
  accepted reference remains available for trading. The app shows the dispute.
- **If the evidence is upheld:** the proposal may proceed once all challenges
  are resolved. Its evidence retains the confidence penalty defined by the
  methodology.
- **If the evidence is disproven:** reject the proposal. A correction must be
  new evidence in a new proposal with a fresh challenge window.

Confidence already reflects source quality and freshness. UMA challenges add
another factor to that calculation. Lower confidence does not directly lower
the economic index or multiply a user's balance. Invalid evidence cannot be
made acceptable simply by assigning it a lower confidence score.

Reusing the same evidence must preserve its challenge history. Later revisions
must not rewrite old published references or silently reprice completed trades.
Section 8 defines how to handle a newly discovered error in an already
published reference.

## 5. What the methodology defines

Every reference version must use one identifiable set of rules. Those rules
define the country roster, indicators, sources, comparison periods, weights,
normalization, WORLD calculation, baseline, multiplier and confidence policy.
They remain fixed within a methodology epoch. An epoch is a period of fixed
rules; it does not automatically mean a calendar year or a trading lock.

The current oracle design uses an equal-weight WORLD containing each configured
country. Pair references use country indices from the same accepted snapshot
and baseline. Confidence changes alone must not create economic movement.

The six implemented source pipelines and current 30-country catalogue are
the v1 calibration universe. Their availability does not prove that every
record is ready for the oracle. Geffy's research informs
source suitability; its infrastructure ratings are not economic weights or
automatic confidence scores.

Unknown publication time stays unknown. When EOX first observed a record is a
different fact from when the source published it. V1 rejects records with unknown publication time for reference publication,
as specified in section 8. Conversions must be explicit and reproducible;
v1 does not admit rounded source values.

## 6. Ownership

Joel owns ingestion, evidence storage, infrastructure signing and app APIs/service
integrations. Peter owns methodology, the Solana oracle and trading contracts.
Godwin owns UMA/dispute relay and the trading UI. Section 8 assigns the changes
at each boundary; section 9 specifies execution order and dependencies.

## 7. What users and operators must be able to see

The app should show the accepted reference, confidence, evidence age, last
publication time and exact reference version. Pending updates and disputes
must be clearly separate from the reference currently used for execution.
Each trade must record the accepted version it used.

Anyone reviewing a reference should be able to trace it to the source records,
methodology and dispute outcome. A service restart must not lose queued
evidence, duplicate publication or expose a partially calculated reference.

When a source, UMA or relay is delayed, keep the last accepted reference
available and show its age and status. Never label old evidence as newly
published just because it was fetched again. The stale-reference and incident restrictions in section 8 apply to execution;
historical references remain readable.

## 8. CODE contract rules

The following instructions resolve the mismatches identified in `SYSTEM.md`.
Each named person must make the stated change in their component. These are
implementation requirements, not options or requests for a later agreement.

### 8.1 Remove the annual settlement dependency

**Mismatch — SYSTEM §2, §3.3 and §6.4:** Godwin's adapter accepts a result for a
calendar year; Peter's oracle needs a dispute result for each proposed update.

**Godwin:** implement a continuous proposal path in `packages/optimistic-oracle`
keyed by deployment, methodology epoch and unique proposal ID. Remove the July
cutoff, 21-day assertion period, 35-day void deadline and one-result-per-year
restriction from this path. Do not send the continuous oracle through the
annual settlement receiver. Leave any retained annual contracts outside this
product's execution path.

**Peter:** give every snapshot a unique proposal ID, a methodology epoch and
its published predecessor. Consume Godwin's result for that proposal. Do not
create an annual evidence selection or wait for an annual claim before publishing.
Treat an epoch as fixed methodology rules, not a calendar year. Keep old epochs
and baselines readable when a new epoch starts.

### 8.2 Replace the conflicting timers with the product's hourly cycle

**Mismatch — SYSTEM §3.1–3.3:** ingestion runs daily, the worker gathers for five
seconds, confidence refreshes every minute, and dispute windows differ between
60 seconds, two hours and 72 hours.

**Joel:** change the ingestion schedule in `deploy/dev` from daily at 06:00 UTC
to hourly. Prevent overlapping runs of the same source job and retain retry
progress. Keep the source's native daily, monthly or quarterly economic period;
polling hourly must not create artificial observations.

**Peter:** change the worker to UTC hourly cutoffs. Replace the five-second
proposal trigger and minute confidence refresh with one proposal at the next
hourly cutoff when idle. Keep the one-hour post-commitment publication expiry.
Freeze evidence at pre-commitment, but do not treat a local pre-commit timer as
proof that UMA's window has completed.

**Peter:** replace the Solana deadline derived from pre-commit time with the
authenticated start and deadline of each registered UMA assertion. Require
each deadline to equal its start plus 3,600 seconds. A late assertion or relay
must not shorten that window. Keep proposal state frozen and pending until
the complete required assertion set has valid settled outcomes.

**Godwin:** set UMA liveness to exactly 3,600 seconds for every assertion in
this path. Start it when the assertion is registered and its supporting evidence
is available. Relay its actual start and deadline. Settle an undisputed assertion
after expiry; wait for UMA resolution when disputed. A timer cannot generate an
accepted result.

### 8.3 Make UMA assertions match the oracle's evidence and snapshot

**Mismatch — SYSTEM §6.2–6.4:** the existing annual claim cannot express the
per-evidence challenges and per-proposal acceptance required by Peter's oracle.

**Peter:** produce two claim types using versioned canonical Borsh encoding and
SHA-256. Publish the encoder and exact-byte/hash examples for Godwin to implement.
Use distinct domains for evidence claims, snapshot claims and relay messages.
Populate these exact bindings:

| Claim | Required binding |
| --- | --- |
| Both | Schema version, source EVM chain/adapter, destination Solana deployment, methodology epoch, manifest digest, on-chain configuration digest and evidence-policy version. |
| Evidence | Portable evidence digest, metadata digest, immutable source record identity, original artifact digests, confidence-assessment digest and supporting provenance digests. |
| Snapshot | Proposal ID, pre-commitment, published predecessor, cutoff, ordered country/indicator slots, current/comparison record and assessment identities, and the required evidence-assertion IDs. |

**Godwin:** implement the evidence claim as: “This observation and assessment
satisfy the identified EOX evidence policy and are supported by the committed
source material.” Implement the snapshot claim as: “This complete ordered
selection follows the identified methodology's cutoff, revision and comparison
rules.” Submit these claims to UMA; do not assert a USDC payout or an annual result.
Reject requests whose contents conflict with an existing request identity.

**Peter:** request evidence assertions first and persist their returned IDs.
Then freeze their mapping into the snapshot claim. Reuse a settled-true evidence
assessment only when its evidence, assessment, policy and epoch are unchanged.
Create new evidence assertions when that assessment or epoch changes.

**Godwin:** register exactly one snapshot assertion against the frozen proposal.
Its own returned UMA ID is added to the closure set after registration; it is
not included in its own claim. Never replace the frozen list or registered
snapshot assertion. An identical retry must return the same assertion ID,
including after a lost response or service restart.

### 8.4 Replace simulated challenge signatures with authenticated relay

**Mismatch — SYSTEM §6.3:** Peter's program trusts a devnet adapter signer,
while Godwin's Wormhole path targets an annual result receiver.

**Godwin:** make the EVM adapter accept callbacks only from its configured UMA
contract and only for registered assertions. Persist registration, dispute and
settlement events. Construct closure from that recorded state. Emit the following
messages through Wormhole and deliver them to Peter's continuous-oracle receiver:

| Message | Payload |
| --- | --- |
| Every message | Schema version, source chain/adapter, destination program/registry, epoch, proposal ID, pre-commitment, proposal event number and event kind. |
| Registered | UMA contract, assertion ID, claim type/digest, subject identity, start and deadline. |
| Disputed | Assertion ID, subject identity and authenticated dispute identity. |
| Settled | Assertion ID, subject identity, true/false result, disputed flag and settlement time. |
| Closed | Required-assertion-set digest, final ordered-event count/digest and accepted/rejected result. |

**Peter:** implement that message schema and verification in the continuous
Solana oracle. Pin the deployed EVM adapter, Wormhole emitter, destination and
schema before opening proposals. Verify Wormhole authentication on-chain; a
worker or relay signature alone cannot authorize acceptance. Keep evidence,
metadata, configuration, manifest and executable-image identities distinct.
Do not implement SYSTEM §6.4's substitution of configuration digest for image ID.

**Godwin:** emit accepted closure only when every required evidence assertion
and the snapshot assertion are settled true. Emit rejection when a required
assertion settles false. An unresolved assertion must block accepted closure.
Reuse original receipts for reused evidence rather than inventing new events.
Relay finalized source-chain outcomes and retry delivery without altering them.

**Peter:** verify the complete required assertion set and its receipts before
accepting closure. Buffer out-of-order messages. Deduplicate by source adapter,
proposal and event number; reject changed contents for the same identity.
Reject wrong deployments, epochs, commitments and stale predecessors. Pause
publication on conflicting authenticated outcomes. Post-commit only after valid
closure; calculate all results and update the latest pointer atomically. Announce
publication only after Solana finalized confirmation.

### 8.5 Preserve the correct confidence effect of each dispute

**Mismatch — SYSTEM §6.2–6.3:** a whole-snapshot UMA verdict does not identify
which individual observation was wrong, but confidence history is per evidence.

**Godwin:** preserve the assertion type and exact subject identity in every
dispute/outcome message. An evidence dispute names the evidence assessment;
a selection dispute names the snapshot. Count one dispute per UMA assertion.
Never turn a rejected snapshot into invented verdicts against its records.

**Peter:** deduplicate challenge history by source chain, UMA contract and
assertion ID. Attach evidence disputes to the stable evidence identity across
proposals and assessment revisions. Apply the existing experimental dispute
factor: five percentage points per unsuccessful challenge, capped at twenty;
pending challenges block acceptance. A false evidence assertion makes that
record ineligible; a false selection assertion rejects that proposal. Neither
case is made acceptable by lowering confidence alone.

**Peter:** keep quality, freshness and dispute confidence separate from the
economic calculation. Retain the v0.1 eight-factor product and minimum of current
and comparison confidence. Do not silently change historical-comparison freshness
or multiply economic references by confidence. Publish unchanged economic outputs
when only confidence changes.

### 8.6 Connect the implemented evidence API to the fixture-only worker

**Mismatch — SYSTEM §2, §5.2, §5.5–5.6:** the provider mapping was unassigned in
practice. Joel's API now exists; Peter's worker still needs its live adapter.

**Joel:** retain the deployed commit-safe change cursor and these routes:
`GET /v1/changes`, `GET /v1/records/:recordId`, and
`GET /v1/artifacts/:sha256`. Return immutable record IDs as
`eox:observation:<id>`, change IDs as `eox:change:<id>`, and opaque durable cursors.
Return raw source values, units, periods, source identities, revision provenance,
coverage, timestamps and artifact links. Do not add methodology-selected
comparisons or fabricated confidence fields to the source facts.

**Peter:** implement the HTTP `EvidenceProvider` in `apps/oracle-worker` against
those routes. Verify artifact hashes, stage changes durably before advancing
the consumed cursor, and resume from the journal after restart. Do not access
Postgres directly or infer ordering from numeric IDs. Map countries through the
methodology catalogue, use `seriesIdentity` and native `periodOrdinal`, select
comparison records and compile confidence assertions on the methodology side.

### 8.7 Resolve publication time without relabelling retrieval time

**Mismatch — SYSTEM §5.4:** the proposed fallback calls first observation time
“publication time” and assumes its error is bounded by one polling interval.
Backfills and outages invalidate that assumption.

**Joel:** keep `published_at`, `known_at` and database-stamped `recorded_at`
separate. Archive an official release notice or actual-release metadata when
it identifies the source edition containing the observation. Link that evidence
to the record. Preserve null publication time where no such evidence exists.
Do not copy first retrieval time into publication time or claim a one-hour or
24-hour error bound. Planned release calendars alone do not prove actual release.

**Peter:** admit only source-supported publication timestamps under v1. Convert
an explicitly stated timezone to UTC Unix seconds. Reject missing timezone,
date-only timestamps, future times, timestamps not exactly representable in
whole seconds, and records published or recorded after the cutoff. Return
`MISSING_PUBLICATION_TIME` or `INVALID_PUBLICATION_TIME` with the record identity.
Keep the last accepted observation when a replacement fails; prevent baseline
publication if a required initial observation fails. Known time cannot override
recorded time.

**Joel:** supply publication provenance through new immutable records or linked
immutable supporting artifacts; never update old evidence in place. An ingestion
correction must not invent a new source-release timestamp.

### 8.8 Resolve raw precision versus rounded stored values

**Mismatch — SYSTEM §5.3:** the store has six-decimal normalized values, some
sources have more precision, and port aggregation currently rounds its sum.

**Joel:** preserve the full original decimal strings and original payloads.
Expose them through the evidence API even when a normalized database column is
rounded. For ports, expose the constituent port/day import and export decimals
and coverage. Do not present a `toFixed(6)` total as exact source evidence.

**Peter:** implement `EXACT-6/V1` input admission: read the raw decimal without
binary floating point, apply only the declared unit conversion, and require
multiplication by 1,000,000 to produce an integer within the oracle's bounds.
Reject excess nonzero precision with `EXCESS_PRECISION`; do not round it or
fall back to the normalized database value. `1.2345670` passes; `1.2345671` fails.
For conversion to millions, `1234567` becomes `1.234567` exactly. Keep this rule
separate from the specified rounding during subsequent oracle calculations.

**Godwin:** run the same declared conversion/admission checks when checking
asserted evidence. Dispute a claim that presents a rounded replacement as the
exact admitted source value.

### 8.9 Resolve revisions and comparison selection

**Mismatch — SYSTEM §5.2 and §6.4:** a vintage string is not a unique revision
identity, and annual selection differs from continuous current/comparison selection.

**Joel:** assign each correction/revision a new immutable record ID, preserve
its source edition and link the superseded record. Expose the source evidence
establishing revision order. Preserve conflicting source records for inspection;
do not overwrite one with whichever arrived last.

**Peter:** use the immutable record identity for revision identity and preserve
the source vintage separately. Validate same-series, acyclic supersession.
Select the latest eligible source revision established by source order at the
cutoff, not lexical IDs or arrival time. Quarantine ambiguous replacements and
carry forward the last accepted observation. Never modify a frozen snapshot.

**Peter:** for GDP, choose the newest eligible edition containing both the
current quarter and its four-quarter comparison in matching units. For ports,
freeze country/port membership and sum import plus export tonnage over 28 complete
UTC days; compare with the equivalent window ending 364 days earlier. Require
every expected port/day and both flows, treating explicit source zero as zero
and absence as missing. Sum exact decimals before applying `EXACT-6/V1`. Commit
the membership, contributing records and aggregation so the result is reproducible.

### 8.10 Make methodology outputs consumable by all components

**Mismatch — SYSTEM §4 and §5.2:** available source feeds do not supply economic
normalization rules or the eight confidence assessments required by the oracle.

**Peter:** publish one immutable methodology artifact for the 30-country,
six-indicator v1 universe. Include source bindings, units, transforms, comparison
periods, normalization anchors, positive equal indicator weights, equal-country
WORLD, multiplier 20, baseline rules, freshness windows and the eight-factor
rating rubric. Compile it into the existing Rust/Solana configuration and use
its exact version in every proposal. Do not let packages choose independent defaults.

**Peter:** produce numeric calibration from the declared 2019–2023 training set
and evaluate it on 2024–2025 data. Commit the actual resulting parameters and
report; do not ship symbolic or placeholder anchors as a live methodology.
Use GDP and property four-quarter changes, unemployment twelve-month changes
(four quarters for New Zealand), core CPI's reported year-over-year level,
policy-rate level and the port transform in §8.9. Retain the fixture methodology
as explicitly synthetic until the populated live artifact is available.

**Peter:** produce record-level confidence manifests containing the eight named
ratings, assessor, rubric version, source policy and supporting artifact digests.
Missing ratings fail admission; they never default to perfect confidence.
Calculate country indices, WORLD, baseline-relative EOX-20 and direct country
pairs with the existing checked fixed-point math. Pairs must share one epoch,
baseline and published snapshot. Keep signed expressed references and no compounding.

**Godwin:** load the methodology and confidence artifacts committed by the
proposal and validate assertions against those exact versions. Do not substitute
Geffy's infrastructure scores for economic weights or observation confidence.

### 8.11 Define backlog, rejection and recovery behavior

**Mismatch — SYSTEM §3.2 and §7:** hourly collection, a longer dispute window
and one active worker proposal otherwise leave scheduling and recovery inconsistent.

**Peter:** process one active proposal. Keep incoming changes in the durable
queue while it is pending. An unresolved dispute blocks new proposals, not reads
of the last accepted reference. After completion, use the next hourly cutoff and
latest eligible queued revisions; do not replay empty missed hours. Quarantine
rejected evidence. Corrections enter a fresh proposal and full challenge window.

**Joel:** keep hourly collection and the evidence API running during disputes
and oracle pauses. Write correction records instead of editing accepted history.

**Godwin:** keep disputed assertions pending until UMA resolves them. Persist
assertion and relay progress through restarts; recover existing transactions and
messages rather than creating replacement challenges or fabricated closure.

**Peter:** after three hours without a new finalized publication, mark current
status stale and block new/increased exposure in the future exchange contract.
Keep historical reads and collateral-backed exits available. On proven material
evidence error or conflicting authenticated outcomes, pause ordinary publication
and new exposure. Permit only a recovery proposal through the full assertion
and verification path. Resume after its finalized publication and recorded incident
resolution. Never rewrite completed trades or published references.

### 8.12 Deploy the missing services and provide one app-facing reference

**Mismatch — SYSTEM §5.7 and §7:** deployment responsibilities are combined,
some completed API/backup work is listed as missing, and the app has no single
finalized-reference interface.

**Joel:** retain the deployed evidence API and existing daily verified backup
job; do not rebuild them as missing features. Provision persistent storage,
service accounts and service supervision on the dev environment for the oracle
worker. Keep database access private and provide the worker's evidence API
connection configuration. Restore backups into a new database and verify hashes
and immutable history before using it.

**Peter:** package, configure and operate the worker on that provisioned runtime.
Use the deployed Solana oracle with the authenticated receiver and a persistent
single-writer journal. Publish its network, program, registry, methodology and
service addresses. Keep secret keys out of the deployment manifest.

**Godwin:** deploy and operate the continuous EVM adapter, assertion/settlement
service, challenger and Wormhole relay. Publish EVM chain, UMA/adapter addresses,
bond token, Wormhole emitter, message version and deployment transactions.
Fund assertions using the current UMA minimum bond from an operating wallet;
stop new assertions when underfunded. Do not spend trader collateral.

**Peter:** publish the on-chain account/event definitions and deterministic
reference/pair readers for Joel to consume. Preserve the version and arithmetic
contract; the HTTP service must not introduce another calculation implementation.

**Joel:** expose one typed app client and API for latest reference, historical snapshot,
country/WORLD, country/country, proposal status, evidence readiness and resumable
finalized-publication subscriptions. Include deployment, epoch, methodology,
baseline, snapshot, sequence, cutoff, post-commitment/publication times, commitments
and finalization identity. Return fixed-point values as scaled integer strings.
Keep committed confidence and evaluation-time ages immutable; report current
staleness, evidence age and eligibility in a separately timestamped status envelope.
A pending proposal never replaces the latest accepted snapshot.

**Joel:** return `NO_ACCEPTED_REFERENCE`, `SNAPSHOT_NOT_FOUND` and `INVALID_PAIR`
explicitly. Supply the same client/response format for the fixture service so app
work can start without inventing another backend contract. Identify fixture/live
origin and never mix networks or baselines. Return the exact snapshot identity for Peter's trade instruction to enforce.
Do not label index values as USDC prices or authorize payouts through
the reference API.

### 8.13 Keep exchange accounting outside oracle acceptance

**Mismatch — SYSTEM §3.3:** the annual oracle schedule is presented as a money
settlement rule even though the exchange's monetary contracts are separate.

**Peter:** implement the reference consumer for immediate execution against the
latest eligible finalized version. Do not add annual locks, order batching or a
requirement to wait for the pending reference. Keep test assets for the initial
integrated release. Before enabling real USDC, implement and verify deposit,
issuance, bounded payout, fee, reserve and redemption equations. Reject obligations
exceeding collateral; debit or burn a funded claim and transfer its USDC backing
atomically. Neither EOX-20 nor confidence directly creates a dollar claim.

**Godwin:** do not use the annual result receiver to unlock ordinary reference
reads or exits. Deliver verification results only; the relay must not mint claims,
move trader collateral or decide payouts.

### 8.14 Replace scattered infrastructure wallets with one signing service

**Mismatch:** the oracle worker loads a local Solana keypair and the UMA client
accepts an EVM wallet. Separate private-key copies and independently configured
public keys can cause authority mismatches, unsafe rotation and service outages.

**Joel:** build `apps/signer` and `packages/signing`. The service holds the signing
policy and calls managed key storage; the package supplies typed remote-signer
clients. Expose `getPublicKey`, `signSolanaTransaction` and `signEvmTransaction`.
Use one interface with separate keys per role, chain and environment. Do not
create one all-powerful key shared by the infrastructure.

**Joel:** use Google Cloud KMS for non-exportable keys: pure Ed25519 for Solana
and secp256k1 for EVM. Use the supported protection level for each algorithm.
Sign Solana message bytes directly. For EVM, sign the transaction's Keccak-256
digest, decode the returned ECDSA signature and verify the recovered address
before returning the signed transaction. Do not accidentally hash the EVM digest
again. Prove both adapters against local verification and testnet transactions.
The relevant provider behavior is documented in [Cloud KMS algorithms](https://docs.cloud.google.com/kms/docs/algorithms)
and [ECDSA digest support](https://docs.cloud.google.com/kms/docs/create-validate-signatures#ecdsa_support_for_other_hash_algorithms).

**Joel:** authenticate each caller by its service identity. Accept only decoded,
allowlisted operations for that caller's role: network, program/contract, method,
accounts/recipient, token, value, fee and spending limits. Reject unknown
instructions and arbitrary opaque signing requests. Check the entire transaction,
including resolved Solana lookup-table addresses. Do not allow a permitted
instruction to conceal an additional transfer or authority change.

**Joel:** require a request ID, role, immutable key version, network, operation
identity, expiry and exact transaction bytes. Persist the request decision and
result. An identical retry returns the recorded result; changed bytes under the
same request ID fail. Log caller, role, payload digest and decision, never secrets.

**Peter:** keep oracle operation IDs and transaction progress in the worker.
Before rebuilding an expired Solana transaction, reconcile its on-chain result;
use a new signing request linked to the same operation only if still needed.

**Godwin:** coordinate EVM nonces per operational account and reconcile uncertain
submissions before replacement. Link a fee replacement or retry to the original
operation. A signing request's idempotency alone does not prevent a duplicated
on-chain action.

**Joel:** publish a versioned public-key directory containing role, environment,
chain, algorithm, public key/address, key version, activation state and validity
period. Never expose private keys. Publish it through authenticated deployment
configuration and a read-only endpoint. Discovery does not grant authority:
contracts must still pin the authorized addresses. Retain old public keys for
historical verification. Rotate through explicit on-chain authority updates;
do not replace a key midway through an open proposal. On compromise, pause the
affected role rather than silently substituting another key.

**Joel:** create role keys and publish their public identities before contract
deployment. Keep signing for an undeployed or unbound target disabled.
**Peter:** deploy the Solana programs using those identities and publish their
addresses and permitted instruction definitions. **Godwin:** deploy the EVM
adapter and publish its address and permitted calls. **Joel:** then bind these
exact deployments into signer policies. **Peter:** pin Godwin's deployed emitter
before enabling proposals. This sequence avoids requiring deployed contracts
to create keys, or requiring a live relay to deploy the receiver.

#### Exact signing connection points

| Connection | Individual implementation action | Key and permitted purpose |
| --- | --- | --- |
| Oracle worker → Solana | **Peter:** replace the wallet-file dependency in `apps/oracle-worker/src/solana.ts` with Joel's remote Anchor-compatible signer. Separate bootstrap/configuration from runtime publication. | `oracle-operator`: permitted proposal, upload, calculation and publication operations only. |
| UMA service → EVM | **Godwin:** adapt the wallet consumed by `packages/optimistic-oracle/sdk/src/evm.ts` to Joel's remote signer. | `uma-asserter`: approved adapter calls and bounded bond-token allowances; no arbitrary transfers. |
| UMA challenger → EVM | **Godwin:** use a separate signer identity for the challenge service. **Peter:** use a distinct checker identity for his independent challenger. | Separate `uma-challenger` and `oracle-checker` accounts; permitted bonded disputes only. |
| Settlement/Wormhole publication → EVM | **Godwin:** connect the settlement and publication service to its operational signer. | `evm-relayer`: settlement and message-publication calls plus bounded fees. |
| Wormhole delivery → Solana | **Godwin:** use Joel's Solana signer to pay for approved proof-posting and receiver transactions. | `solana-relayer`: delivery fees and instructions; no oracle-admin authority. |
| Registry, epoch and exchange setup | **Peter:** implement distinct admin and runtime authorities. **Godwin:** do the same in the EVM adapter. | Admin/upgrade keys stay outside the automatic signing API; use controlled deployment/multisig operations. |
| App APIs and UI | **Joel:** expose public addresses and build unsigned user transactions. **Godwin:** request user signatures from the connected wallet. | User keys remain in user wallets. No infrastructure key signs a user's trade. |

**Joel:** keep signing infrastructure private to authenticated services. Source
reads and ordinary public API reads do not require a blockchain signature. Use
normal service authentication for the evidence API. A new signature does not make
source data true, prove UMA acceptance or replace Wormhole guardian signatures.
On signer outage, pause affected writes and preserve queues; keep reads available.
Never fall back to a shared local private key.

### 8.15 Build the trading app against the converged infrastructure

**Mismatch:** the app was previously unassigned and API ownership overlapped
with oracle ownership. For this release, Godwin owns UI, Peter owns contracts,
and Joel owns APIs plus connections to the infrastructure and external services.

**Peter:** implement the Solana exchange contracts for collateral deposits,
position issuance, country/WORLD and country/country execution, position reduction,
fees and USDC withdrawal/redemption. First write the exact payoff, quote, reserve
and maximum-liability equations and test them; do not encode EOX-20 directly as a
USDC price. Publish the resulting instruction/account/event definitions, errors,
quote examples and test vectors for Joel. Enforce solvency, user authorization,
slippage, expiry, snapshot consistency and stale/incident restrictions on-chain.
Store the actual snapshot used. Reject a changed-reference quote so the client
can rebuild it; never silently execute at a different reference.

**Joel:** implement the app API and typed client using Peter's published contract
interfaces. Connect to Solana RPC, finalized reference updates, exchange accounts
and events, evidence artifacts and Godwin's dispute-status service. Serve markets,
references, confidence, proposal/dispute status, wallet positions, collateral,
trade history and executable quotes. Index finalized trades with durable progress;
label pending transactions separately. Derive trading candles from executed trades
and reference history from oracle publications; never mix the two series.

**Joel:** build unsigned deposit, trade, reduction and withdrawal transactions
from Peter's instructions. Return the network, program, accounts, amounts, fees,
slippage bound, expiry and reference identity for the UI to show. Submission and
retry handling must preserve the user's signed bytes; changed quotes require
another user signature. The API cannot bypass contract validation, create an
unfunded balance or authorize a payout. Fixture responses must use the same
versioned schema and be visibly labelled as fixtures.

**Godwin:** implement wallet connection, market/pair selection, reference and
confidence display, trading candles, deposit, buy/sell, position reduction,
withdrawal, portfolio and transaction history screens. Use Joel's typed client.
Show the quote, fees, slippage and reference age before requesting the user's
wallet signature. Handle stale references, insufficient collateral, failed or
expired transactions, pending disputes and disconnected services explicitly.
Do not wait for a pending oracle proposal before letting the user use the last
eligible finalized reference. Do not require an EOX server signature to authorize
an ordinary user trade.

**Peter:** deploy the exchange with test assets first and verify accounting and
reference-consumption behavior. **Joel:** connect the API to that deployment and
reconcile indexed balances with chain state. **Godwin:** connect the UI to that
API and demonstrate deposit → trade → reduce/exit → withdraw. Real-money release
remains gated by section 8.13; the UI and API work starts earlier.

## 9. Execution order, parallel work and blockers

The numbered tasks below are the execution plan. Each has one owner. A dependency
blocks that task's live completion, not unrelated development with fixtures.
No date estimate is implied. Tasks for the same person remain that person's queue;
parallel tracks identify work different owners can progress independently.

### First: establish the interfaces

| Step | Owner | Exact work and output | Dependency |
| --- | --- | --- | --- |
| 1 | Peter | Publish oracle claim/relay schemas, encoding vectors, account/event layouts and deterministic reference readers for §8.3–8.6. | Start now; existing fixture oracle is the base. |
| 2 | Joel | Publish signing client/request/key-directory types, app API types and a fixture API implementing those responses. | Use step 1 for final oracle fields; the signer and UI fixture skeleton can start immediately. |
| 3 | Godwin | Start trading UI screens, wallet connection and fixture-driven reference/portfolio/status views. | Step 2 fixture API. No dependency on live UMA, live source readiness or trading-contract deployment. |

### Next: advance the infrastructure and trading design in parallel

| Step | Owner | Exact work and output | Dependency |
| --- | --- | --- | --- |
| 4 | Joel | Build and deploy signing service, isolated operational keys, caller policies and public-key directory; verify both chain adapters. | Step 2 signing types. Live completion needs cloud key access, service identities and test funds. |
| 5 | Joel | Deliver hourly ingestion, exact source/API mappings, release provenance, immutable revisions and retrievable port constituents under §8.6–8.9. | Existing API; independent of UMA and exchange. Follows step 4 in Joel's default queue. |
| 6 | Peter | Implement admission, hourly worker, methodology/assessment artifacts and authenticated Solana receiver under §8.1–8.11. Integrate the remote signer. | Step 1. Deploy the receiver after 4 without waiting for live relay delivery. Complete live-input admission after 5 and calibration; test full relay acceptance at 13. |
| 7 | Godwin | Implement recurring UMA assertions, challenge handling, closure and relay against step 1's vectors; integrate the remote signer. | Step 1; live signing/delivery needs 4 and step 6's receiver deployment. UI work from 3 can continue with fixtures. |
| 8 | Peter | Write executable exchange payoff/quote/reserve equations, test collateral invariants, and publish trade instruction/event schemas and quote vectors. | Step 1 reference semantics; does not wait for live data or UMA. Complete before trading-contract implementation. |
| 9 | Joel | Implement app reference/status APIs and finalized indexer using Peter's readers; connect evidence and dispute services; keep the fixture API available. | Steps 1–2. Live connections need 5, 6 and 7; reference API development can precede those deployments. |

Steps 4–5, step 6 and step 7 are separate owner tracks. Peter schedules step 8
alongside his oracle work; it is the trading track's first hard dependency.
Godwin can finish fixture UI while waiting for signer/receiver deployment.
Joel can build step 9 against recorded events while the pipeline is being connected.

### Then: connect contracts, APIs and UI

| Step | Owner | Exact work and output | Dependency |
| --- | --- | --- | --- |
| 10 | Peter | Implement and deploy test-asset exchange contracts; test deposits, execution, reserve limits, exits, withdrawals and snapshot/slippage checks. | Step 8 equations and interfaces. Use a controlled fixture reference deployment until step 6 is ready. |
| 11 | Joel | Implement executable quotes, unsigned transaction builders, submission tracking, positions, balances and executed-trade candles. | Step 8 vectors and step 9 API; end-to-end transactions require step 10 deployment. |
| 12 | Godwin | Connect UI trading actions to Joel's API and the user's wallet; complete portfolio/history and error flows. | Steps 3 and 11; real test-asset actions need step 10. |
| 13 | Peter | Run the real-evidence → pre-commit → UMA → Wormhole → Solana demonstration; record acceptance, rejection, correction, confidence refresh and restart behavior. | Steps 4–7 and the populated methodology artifact. API visibility uses step 9. Can run independently of UI completion. |
| 14 | Joel | Connect the app API to the verified live-data oracle and exchange deployments; verify history, subscription recovery and chain/indexer balance equality. | Steps 9–11 and 13. |
| 15 | Godwin | Demonstrate the complete devnet user journey: deposit, trade using an accepted reference, trade while another proposal is pending, reduce/exit and withdraw. | Steps 12 and 14. |
| 16 | Peter | Verify end-to-end collateral accounting, contract authorization, stale/incident behavior and finalization; publish the integrated test results. | Steps 13–15. Real-USDC activation additionally requires the security and accounting gate in §8.13. |

### Blockers that must stay visible

- **Joel — source readiness:** absent source-supported publication timestamps,
  unusable revision provenance or incomplete constituents block those records.
  They do not block UI work or fixture integration. Report the affected slots.
- **Peter — methodology readiness:** unpopulated calibration parameters or missing
  confidence assessments block the live baseline. Do not mark a fixture run as a
  completed live-data demonstration.
- **Joel — signing readiness:** missing permissions, policy configuration or funded
  operational accounts block service transactions. They do not block public reads.
- **Godwin — assertion/relay readiness:** unresolved disputes or incomplete verified
  delivery block publication; they do not invalidate the previous accepted reference.
- **Peter — trading mathematics:** missing payoff/reserve equations block executable
  quote semantics and exchange correctness. Screens may use labelled fixtures;
  no API developer or UI developer invents these equations to unblock themselves.

The first app work starts at step 3. The first connected test-asset trading path
is steps 10–12. Full live-data devnet integration is complete at step 16.
