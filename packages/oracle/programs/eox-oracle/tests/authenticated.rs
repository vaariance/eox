use eox_oracle_math::{self as math, protocol as wire};
use math::relay::{verify_posted_relay, RelayDestination};

fn posted(message: &wire::RelayMessage, emitter: [u8; 32], sequence: u64) -> Vec<u8> {
    let payload = message.encode().unwrap();
    let mut bytes = vec![0u8; 95];
    bytes[..3].copy_from_slice(b"vaa");
    bytes[3] = 1;
    bytes[4] = 1;
    bytes[49..57].copy_from_slice(&sequence.to_le_bytes());
    bytes[57..59].copy_from_slice(&message.header.wormhole_chain.to_le_bytes());
    bytes[59..91].copy_from_slice(&emitter);
    bytes[91..95].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend(payload);
    bytes
}

#[test]
fn posted_vaa_authentication_rejects_wrong_origin_destination_and_shape() {
    let destination = RelayDestination {
        wormhole_program: [1; 32], evm_chain_id: 11155111, wormhole_chain: 10002,
        emitter: [2; 32], adapter: [3; 20], uma: [4; 20], program: [5; 32],
        registry: [6; 32], epoch: 1, proposal: [7; 32], precommitment: [8; 32], consistency_level: 1,
    };
    let message = wire::RelayMessage {
        header: wire::RelayHeader { version: 1, evm_chain_id: destination.evm_chain_id,
            wormhole_chain: destination.wormhole_chain, adapter: destination.adapter,
            solana_program: destination.program, registry: destination.registry, epoch: 1,
            proposal: destination.proposal, precommitment: destination.precommitment, event_number: 1 },
        event: wire::RelayEvent::Registered { uma: destination.uma, assertion_id: [9; 32],
            claim_kind: wire::ClaimKind::Evidence, claim_digest: [10; 32], subject: [10; 32], start: 100, deadline: 3700 },
    };
    let bytes = posted(&message, destination.emitter, 55);
    let verified = verify_posted_relay(destination.wormhole_program, &bytes, &destination).unwrap();
    assert_eq!(verified.wormhole_sequence, 55);
    assert_eq!(verified.message.commitment().unwrap(), message.commitment().unwrap());
    assert!(verify_posted_relay([99; 32], &bytes, &destination).is_err());
    for offset in [0, 3, 4, 57, 59, 91, 95, 97, 105, 107, 127, 159, 191, 199, 231] {
        let mut invalid = bytes.clone();
        invalid[offset] ^= 0x40;
        assert!(verify_posted_relay(destination.wormhole_program, &invalid, &destination).is_err(), "offset {offset}");
    }
    for length in [0, 3, 94, bytes.len() - 1] {
        assert!(verify_posted_relay(destination.wormhole_program, &bytes[..length], &destination).is_err());
    }
    let mut extra = bytes.clone(); extra.push(0);
    assert!(verify_posted_relay(destination.wormhole_program, &extra, &destination).is_err());
    let mut annual = bytes[..95].to_vec(); annual.extend([0; 167]);
    annual[91..95].copy_from_slice(&167u32.to_le_bytes());
    assert!(verify_posted_relay(destination.wormhole_program, &annual, &destination).is_err());
}

use ::eox_oracle::{accounts as a, instruction as i, Epoch, Registry, Snapshot, ID};
use anchor_lang::AnchorSerialize;
use solana_sdk::{account::Account, pubkey::Pubkey, signature::Signer, system_program};
mod support;
use support::{pda, Harness};

fn record_text(evidence: &math::Evidence) -> String {
    evidence.record_id.iter().map(|b| format!("{b:02x}")).collect()
}

fn evidence_claim(context: wire::ClaimContext, evidence: &math::Evidence) -> wire::EvidenceClaim {
    wire::EvidenceClaim {
        context,
        evidence_digest: math::evidence_digest(evidence).unwrap(),
        metadata_digest: evidence.metadata_digest,
        record_id: record_text(evidence),
        artifact_digests: vec![evidence.artifact_digest],
        assessment_digest: [41; 32],
        provenance_digests: vec![[42; 32]],
    }
}

use ::eox_oracle::{AuthenticatedProposal, ReceiverSettings};
struct AuthHarness {
    h: Harness,
    receiver: Pubkey,
    settings: ReceiverSettings,
    snapshot: Pubkey,
    auth: Pubkey,
    number: u64,
    history: [u8; 32],
}
impl AuthHarness {
    fn new(countries: u8, indicators: u8) -> Self {
        let mut h = Harness::new(countries, indicators);
        let receiver = pda(&[b"receiver", h.registry.as_ref(), &1u64.to_le_bytes()]);
        let settings = ReceiverSettings { wormhole_program: Pubkey::new_unique(), evm_chain_id: 11155111,
            wormhole_chain: 10002, emitter: [2; 32], adapter: [3; 20], uma: [4; 20],
            consistency_level: 1, schema_version: 1, methodology_manifest: [5; 32], evidence_policy: [6; 32] };
        h.send(a::CreateReceiver { registry: h.registry, epoch: h.epoch, epoch_auth: pda(&[b"epoch-auth", h.epoch.as_ref()]), receiver, authority: h.authority.pubkey(), system_program: system_program::ID },
            i::CreateReceiver { id: 1, settings: settings.clone() }, false, true);
        let snapshot = h.new_snapshot_with(0, |h, snapshot| {
            h.send(a::PinReceiver { registry: h.registry, epoch: h.epoch, receiver, snapshot,
                auth: pda(&[b"authenticated", snapshot.as_ref()]), authority: h.authority.pubkey(), system_program: system_program::ID }, i::PinReceiver {}, false, true);
        });
        let auth = pda(&[b"authenticated", snapshot.as_ref()]);
        let mut this = Self { h, receiver, settings, snapshot, auth, number: 0, history: [0; 32] };
        this.h.send(this.operation(), i::PrecommitAuthenticated {}, false, true);
        this
    }
    fn operation(&self) -> a::AuthOperation {
        a::AuthOperation { registry: self.h.registry, epoch: self.h.epoch, receiver: self.receiver,
            snapshot: self.snapshot, auth: self.auth, authority: self.h.authority.pubkey() }
    }
    fn assertion(&self, id: [u8; 32]) -> Pubkey {
        pda(&[b"assertion", &self.settings.evm_chain_id.to_le_bytes(), &self.settings.uma, &id])
    }
    fn claim_address(&self, digest: [u8; 32]) -> Pubkey { pda(&[b"claim", self.receiver.as_ref(), &digest]) }
    fn claim(&self, e: &math::Evidence) -> wire::EvidenceClaim {
        let epoch: Epoch = self.h.read(self.h.epoch);
        evidence_claim(wire::ClaimContext { version: 1, evm_chain_id: self.settings.evm_chain_id,
            adapter: self.settings.adapter, solana_program: ID.to_bytes(), registry: self.h.registry.to_bytes(), epoch: 1,
            methodology_manifest: self.settings.methodology_manifest, configuration_digest: epoch.configuration_digest,
            evidence_policy: self.settings.evidence_policy }, e)
    }
    fn upload(&mut self, claim: &wire::EvidenceClaim) {
        let digest = claim.commitment().unwrap();
        let address = self.claim_address(digest);
        for (index, chunk) in claim.encode().unwrap().chunks(512).enumerate() {
            self.h.send(a::UploadClaim { registry: self.h.registry, receiver: self.receiver, claim: address,
                authority: self.h.authority.pubkey(), system_program: system_program::ID },
                i::UploadClaim { digest, offset: (index * 512) as u32, bytes: chunk.to_vec() }, false, true);
        }
        self.h.send(a::SealClaim { epoch: self.h.epoch, receiver: self.receiver, claim: address }, i::SealClaim {}, false, true);
    }
    fn message(&self, number: u64, event: wire::RelayEvent) -> wire::RelayMessage {
        let snapshot: Snapshot = self.h.read(self.snapshot);
        wire::RelayMessage { header: wire::RelayHeader { version: 1, evm_chain_id: self.settings.evm_chain_id,
            wormhole_chain: self.settings.wormhole_chain, adapter: self.settings.adapter, solana_program: ID.to_bytes(),
            registry: self.h.registry.to_bytes(), epoch: 1, proposal: self.snapshot.to_bytes(),
            precommitment: snapshot.precommitment, event_number: number }, event }
    }
    fn receive(&mut self, message: &wire::RelayMessage, owner: Pubkey, succeeds: bool) {
        let vaa = Pubkey::new_unique();
        self.h.svm.set_account(vaa, Account { lamports: 10_000_000, data: posted(message, self.settings.emitter, message.header.event_number), owner, executable: false, rent_epoch: 0 }).unwrap();
        self.h.send(a::ReceiveRelay { registry: self.h.registry, epoch: self.h.epoch, snapshot: self.snapshot,
            receiver: self.receiver, auth: self.auth, posted_vaa: vaa, receipt: pda(&[b"relay", self.auth.as_ref(), &message.header.event_number.to_le_bytes()]),
            payer: self.h.adapter.pubkey(), system_program: system_program::ID }, i::ReceiveRelay { event_number: message.header.event_number }, true, succeeds);
    }
    fn apply(&mut self, message: &wire::RelayMessage, claim: Option<&wire::EvidenceClaim>, succeeds: bool) {
        let id = match message.event {
            wire::RelayEvent::Registered { assertion_id, .. } | wire::RelayEvent::Disputed { assertion_id, .. } |
            wire::RelayEvent::Settled { assertion_id, .. } => assertion_id,
            wire::RelayEvent::Closed { .. } => [0; 32],
        };
        self.h.send(a::ApplyRelay { registry: self.h.registry, epoch: self.h.epoch, snapshot: self.snapshot,
            receiver: self.receiver, auth: self.auth, receipt: pda(&[b"relay", self.auth.as_ref(), &message.header.event_number.to_le_bytes()]),
            assertion: self.assertion(id), claim: claim.map(|v| self.claim_address(v.commitment().unwrap())),
            history: claim.map(|v| pda(&[b"history", &v.evidence_digest])), payer: self.h.adapter.pubkey(), system_program: system_program::ID }, i::ApplyRelay {}, true, succeeds);
    }
    fn deliver(&mut self, event: wire::RelayEvent, claim: Option<&wire::EvidenceClaim>) -> wire::RelayMessage {
        let message = self.message(self.number + 1, event);
        self.receive(&message, self.settings.wormhole_program, true);
        self.apply(&message, claim, true);
        self.number += 1;
        if !matches!(message.event, wire::RelayEvent::Closed { .. }) {
            self.history = wire::event_history_digest(self.history, &message).unwrap();
        }
        message
    }
    fn member(&self, id: [u8; 32]) -> a::MembershipOperation {
        let assertion = self.assertion(id);
        a::MembershipOperation { epoch: self.h.epoch, registry: self.h.registry, snapshot: self.snapshot,
            receiver: self.receiver, auth: self.auth, assertion, membership: pda(&[b"membership", self.auth.as_ref(), assertion.as_ref()]) }
    }
    fn bind(&mut self, country: u8, indicator: u8, comparison: bool, claim: &wire::EvidenceClaim, id: [u8; 32]) {
        let assertion = self.assertion(id);
        self.h.send(a::BindClaim { registry: self.h.registry, epoch: self.h.epoch, snapshot: self.snapshot,
            receiver: self.receiver, auth: self.auth, page_account: self.h.page(self.snapshot, country, indicator / 8),
            claim: self.claim_address(claim.commitment().unwrap()), assertion,
            membership: pda(&[b"membership", self.auth.as_ref(), assertion.as_ref()]),
            binding: pda(&[b"binding", self.auth.as_ref(), &[country], &[indicator], &[comparison as u8]]),
            authority: self.h.authority.pubkey(), system_program: system_program::ID },
            i::BindClaim { country, indicator, comparison }, false, true);
    }
    fn prepare(&mut self) -> Vec<([u8; 32], wire::EvidenceClaim)> {
        self.h.send(self.operation(), i::BeginSnapshotClaim {}, false, true);
        let mut claims = Vec::new();
        for c in 0..self.h.n {
            for j in 0..self.h.indicators {
                let slot = self.h.slot(c, j, 0);
                for (comparison, evidence) in [(false, slot.current), (true, slot.comparison.unwrap())] {
                    let claim = self.claim(&evidence);
                    self.upload(&claim);
                    let mut id = [0; 32]; id[28..].copy_from_slice(&((claims.len() + 1) as u32).to_be_bytes());
                    let digest = claim.commitment().unwrap();
                    self.deliver(wire::RelayEvent::Registered { uma: self.settings.uma, assertion_id: id,
                        claim_kind: wire::ClaimKind::Evidence, claim_digest: digest, subject: digest, start: 100_000, deadline: 103_600 }, Some(&claim));
                    self.bind(c, j, comparison, &claim, id);
                    claims.push((id, claim));
                }
            }
        }
        for (id, _) in &claims { self.h.send(self.member(*id), i::AppendAssertion {}, false, true); }
        self.h.send(self.operation(), i::SealSnapshotClaim {}, false, true);
        let digest = self.h.read::<AuthenticatedProposal>(self.auth).claim_digest;
        self.deliver(wire::RelayEvent::Registered { uma: self.settings.uma, assertion_id: [99; 32],
            claim_kind: wire::ClaimKind::Snapshot, claim_digest: digest, subject: digest, start: 100_000, deadline: 103_600 }, None);
        claims
    }
    fn accept(&mut self, claims: &[([u8; 32], wire::EvidenceClaim)]) {
        self.h.time(103_600);
        for (id, claim) in claims {
            self.deliver(wire::RelayEvent::Settled { assertion_id: *id, subject: claim.commitment().unwrap(), accepted: true, disputed: false, settled_at: 103_600 }, Some(claim));
            self.h.send(self.member(*id), i::AuditAssertion {}, false, true);
        }
        let auth: AuthenticatedProposal = self.h.read(self.auth);
        self.deliver(wire::RelayEvent::Settled { assertion_id: auth.snapshot_assertion, subject: auth.claim_digest, accepted: true, disputed: false, settled_at: 103_600 }, None);
        let auth: AuthenticatedProposal = self.h.read(self.auth);
        self.deliver(wire::RelayEvent::Closed { assertion_set_digest: auth.assertion_set_digest, event_count: self.number, event_digest: self.history, accepted: true }, None);
    }
}

#[test]
#[ignore = "requires compiled SBF artifact"]
fn authenticated_lifecycle_publishes_only_after_verified_closure() {
    let mut a = AuthHarness::new(2, 1);
    a.h.send(a.h.operation(a.snapshot), i::Postcommit {}, false, false);
    a.h.register(a.snapshot, 0, [88; 32], false);
    let claims = a.prepare();
    a.h.send(a.h.operation(a.snapshot), i::Postcommit {}, false, false);
    a.accept(&claims);
    a.h.send(a.h.operation(a.snapshot), i::Postcommit {}, false, true);
    a.h.calculate(a.snapshot, 0);
    a.h.publish(a.snapshot);
    let reference: Snapshot = a.h.read(a.snapshot);
    assert_eq!(reference.status, 4);
    assert!(reference.countries.iter().all(|c| c.expressed == 100_000_000));
    assert_eq!(a.h.read::<Registry>(a.h.registry).latest, a.snapshot);
    println!("authenticated lifecycle tx={} bytes compute={}", a.h.max_bytes, a.h.max_compute);
}

#[test]
#[ignore = "requires compiled SBF artifact"]
fn authenticated_maximum_universe_uses_bounded_transactions() {
    let mut a = AuthHarness::new(30, 32);
    let claims = a.prepare();
    a.accept(&claims);
    a.h.send(a.h.operation(a.snapshot), i::Postcommit {}, false, true);
    a.h.calculate(a.snapshot, 0);
    a.h.publish(a.snapshot);
    assert_eq!(a.h.read::<Snapshot>(a.snapshot).countries.len(), 30);
    assert!(a.h.max_compute <= 200_000);
    println!("authenticated 30x32 tx={} bytes compute={}", a.h.max_bytes, a.h.max_compute);
}

#[test]
#[ignore = "requires compiled SBF artifact"]
fn authenticated_delivery_order_duplicates_and_permanent_incident() {
    let mut a = AuthHarness::new(2, 1);
    let claim = a.claim(&a.h.slot(0, 0, 0).current);
    a.upload(&claim);
    let digest = claim.commitment().unwrap();
    let event = wire::RelayEvent::Registered { uma: a.settings.uma, assertion_id: [31; 32], claim_kind: wire::ClaimKind::Evidence,
        claim_digest: digest, subject: digest, start: 100_000, deadline: 103_600 };
    let first = a.message(1, event.clone());
    let second = a.message(2, event);
    a.receive(&first, Pubkey::new_unique(), false);
    let mut replay = first.clone(); replay.header.proposal = [44; 32];
    a.receive(&replay, a.settings.wormhole_program, false);
    a.receive(&second, a.settings.wormhole_program, true);
    a.apply(&second, Some(&claim), false);
    a.receive(&first, a.settings.wormhole_program, true);
    a.apply(&first, Some(&claim), true);
    a.receive(&first, a.settings.wormhole_program, true);
    a.apply(&first, Some(&claim), true);
    assert_eq!(a.h.read::<AuthenticatedProposal>(a.auth).applied_events, 1);
    a.apply(&second, Some(&claim), true);
    assert_eq!(a.h.read::<AuthenticatedProposal>(a.auth).applied_events, 2);
    let mut conflict = first;
    if let wire::RelayEvent::Registered { assertion_id, .. } = &mut conflict.event { *assertion_id = [32; 32]; }
    a.receive(&conflict, a.settings.wormhole_program, true);
    assert!(a.h.read::<AuthenticatedProposal>(a.auth).incident);
    assert!(a.h.read::<Registry>(a.h.registry).paused);
    a.h.send(a::Admin { registry: a.h.registry, authority: a.h.authority.pubkey() }, i::SetPause { paused: false }, false, false);
    a.h.send(a.h.operation(a.snapshot), i::Postcommit {}, false, false);
}

#[test]
#[ignore = "requires compiled SBF artifact"]
fn authenticated_false_evidence_and_snapshot_have_distinct_history_effects() {
    for false_snapshot in [false, true] {
        let mut a = AuthHarness::new(2, 1);
        let claims = a.prepare();
        let auth: AuthenticatedProposal = a.h.read(a.auth);
        let (id, subject, claim) = if false_snapshot {
            (auth.snapshot_assertion, auth.claim_digest, None)
        } else { (claims[0].0, claims[0].1.commitment().unwrap(), Some(&claims[0].1)) };
        a.deliver(wire::RelayEvent::Disputed { assertion_id: id, subject, dispute_id: [91; 32] }, claim);
        a.h.time(103_600);
        a.deliver(wire::RelayEvent::Settled { assertion_id: id, subject, accepted: false, disputed: true, settled_at: 103_600 }, claim);
        assert_eq!(a.h.read::<Snapshot>(a.snapshot).status, 5);
        let history: ::eox_oracle::EvidenceHistory = a.h.read(pda(&[b"history", &claims[0].1.evidence_digest]));
        assert_eq!(history.invalid, !false_snapshot);
        assert_eq!(history.rejected, 0);
        assert_eq!(history.pending, 0);
        a.h.send(a.h.operation(a.snapshot), i::Postcommit {}, false, false);
        assert_eq!(a.h.read::<Registry>(a.h.registry).latest, Pubkey::default());
    }
}

#[test]
#[ignore = "requires compiled SBF artifact"]
fn authenticated_dispute_upheld_has_one_penalty_and_blocks_early_settlement() {
    let mut a = AuthHarness::new(2, 1);
    let claims = a.prepare();
    let (id, claim) = &claims[0];
    let subject = claim.commitment().unwrap();
    let dispute = a.deliver(wire::RelayEvent::Disputed { assertion_id: *id, subject, dispute_id: [91; 32] }, Some(claim));
    a.apply(&dispute, Some(claim), true);
    let history_address = pda(&[b"history", &claim.evidence_digest]);
    assert_eq!(a.h.read::<::eox_oracle::EvidenceHistory>(history_address).pending, 1);
    let settlement = a.message(a.number + 1, wire::RelayEvent::Settled { assertion_id: *id, subject, accepted: true, disputed: true, settled_at: 103_600 });
    a.receive(&settlement, a.settings.wormhole_program, true);
    a.apply(&settlement, Some(claim), false);
    a.h.time(103_600);
    a.apply(&settlement, Some(claim), true);
    a.apply(&settlement, Some(claim), true);
    let history: ::eox_oracle::EvidenceHistory = a.h.read(history_address);
    assert_eq!(history.pending, 0);
    assert_eq!(history.rejected, 1);
    assert!(!history.invalid);
    a.h.send(a.h.operation(a.snapshot), i::Postcommit {}, false, false);
}
