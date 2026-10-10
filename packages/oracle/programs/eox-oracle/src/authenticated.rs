use super::*;
use math::protocol::{self as wire, ClaimKind, RelayEvent};
use math::streaming::StreamingHash;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ReceiverSettings {
    pub wormhole_program: Pubkey,
    pub evm_chain_id: u64,
    pub wormhole_chain: u16,
    pub emitter: [u8; 32],
    pub adapter: [u8; 20],
    pub uma: [u8; 20],
    pub consistency_level: u8,
    pub schema_version: u16,
    pub methodology_manifest: [u8; 32],
    pub evidence_policy: [u8; 32],
}
#[account]
pub struct EpochAuthentication {
    pub epoch: Pubkey,
    pub methodology_manifest: [u8;32],
    pub evidence_policy: [u8;32],
}
#[account]
pub struct ReceiverConfig {
    pub registry: Pubkey,
    pub epoch: Pubkey,
    pub id: u64,
    pub settings: ReceiverSettings,
}
#[account]
pub struct AuthenticatedProposal {
    pub snapshot: Pubkey,
    pub receiver: Pubkey,
    pub started: bool,
    pub frozen: bool,
    pub incident: bool,
    pub slot_cursor: u16,
    pub comparison_next: bool,
    pub unique_assertions: u32,
    pub appended_assertions: u32,
    pub audited_assertions: u32,
    pub last_assertion: [u8; 32],
    pub claim_hash: Vec<u8>,
    pub set_hash: Vec<u8>,
    pub claim_digest: [u8; 32],
    pub snapshot_assertion: [u8; 32],
    pub assertion_set_digest: [u8; 32],
    pub snapshot_accepted: bool,
    pub applied_events: u64,
    pub event_digest: [u8; 32],
}
#[account]
pub struct AuthenticatedClaim {
    pub receiver: Pubkey,
    pub digest: [u8; 32],
    pub sealed: bool,
    pub bytes: Vec<u8>,
}
#[account]
pub struct AuthenticatedAssertion {
    pub receiver: Pubkey,
    pub id: [u8; 32],
    pub claim_digest: [u8; 32],
    pub evidence_digest: [u8; 32],
    pub snapshot: bool,
    pub start: u64,
    pub deadline: u64,
    pub disputed: bool,
    pub dispute_id: [u8; 32],
    pub outcome: u8,
}
#[account]
pub struct AssertionMembership {
    pub proposal: Pubkey,
    pub assertion: Pubkey,
    pub used: bool,
    pub appended: bool,
    pub audited: bool,
}
#[account]
pub struct BoundClaim {
    pub digest: [u8;32],
}
#[account]
pub struct AuthenticatedRelayReceipt {
    pub proposal: Pubkey,
    pub event_number: u64,
    pub digest: [u8; 32],
    pub wormhole_sequence: u64,
    pub applied: bool,
    pub bytes: Vec<u8>,
}
#[event]
pub struct AuthenticatedIncident {
    pub snapshot: Pubkey,
    pub event_number: u64,
    pub expected: [u8; 32],
    pub received: [u8; 32],
}
fn context(config: &ReceiverConfig, epoch: &Epoch) -> wire::ClaimContext {
    wire::ClaimContext {
        version: config.settings.schema_version,
        evm_chain_id: config.settings.evm_chain_id,
        adapter: config.settings.adapter,
        solana_program: crate::ID.to_bytes(),
        registry: config.registry.to_bytes(),
        epoch: epoch.id,
        methodology_manifest: config.settings.methodology_manifest,
        configuration_digest: epoch.configuration_digest,
        evidence_policy: config.settings.evidence_policy,
    }
}
fn load_hash(bytes: &[u8]) -> Result<StreamingHash> { decode(bytes) }
fn update_hash(bytes: &mut Vec<u8>, value: &[u8]) -> Result<()> {
    let mut h = load_hash(bytes)?;
    m(h.update(value))?;
    *bytes = h.try_to_vec()?;
    Ok(())
}
fn incident(registry: &mut Registry, auth: &mut AuthenticatedProposal, event_number: u64, expected: [u8; 32], received: [u8; 32]) {
    registry.paused = true;
    registry.adapter = EMPTY;
    auth.incident = true;
    emit!(AuthenticatedIncident { snapshot: auth.snapshot, event_number, expected, received });
}
pub fn create_receiver(ctx: Context<CreateReceiver>, id: u64, settings: ReceiverSettings) -> Result<()> {
    require!(settings.schema_version == 1 && settings.wormhole_program != EMPTY && settings.evm_chain_id != 0 && settings.wormhole_chain != 0 && settings.emitter != [0;32] && settings.adapter != [0;20] && settings.uma != [0;20], OracleError::Identity);
    require!(ctx.accounts.epoch.sealed, OracleError::State);
    let policy = &mut ctx.accounts.epoch_auth;
    if policy.epoch == EMPTY {
        policy.epoch = ctx.accounts.epoch.key();
        policy.methodology_manifest = settings.methodology_manifest;
        policy.evidence_policy = settings.evidence_policy;
    } else {
        require!(policy.epoch == ctx.accounts.epoch.key() && policy.methodology_manifest == settings.methodology_manifest && policy.evidence_policy == settings.evidence_policy, OracleError::Identity);
    }
    let c = &mut ctx.accounts.receiver;
    c.registry = ctx.accounts.registry.key(); c.epoch = ctx.accounts.epoch.key(); c.id = id; c.settings = settings;
    Ok(())
}
pub fn pin_receiver(ctx: Context<PinReceiver>) -> Result<()> {
    let s = &mut ctx.accounts.snapshot;
    active(&ctx.accounts.registry, s, s.key())?;
    require!(s.status == DRAFT, OracleError::State);
    let a = &mut ctx.accounts.auth;
    a.snapshot = s.key(); a.receiver = ctx.accounts.receiver.key();
    s.adapter = a.key();
    Ok(())
}
pub fn upload_claim(ctx: Context<UploadClaim>, digest: [u8;32], offset: u32, bytes: Vec<u8>) -> Result<()> {
    require!(!bytes.is_empty() && bytes.len() <= 512, OracleError::Bounds);
    let c = &mut ctx.accounts.claim;
    if c.receiver == EMPTY { c.receiver = ctx.accounts.receiver.key(); c.digest = digest; }
    require!(c.receiver == ctx.accounts.receiver.key() && c.digest == digest, OracleError::Identity);
    let offset = offset as usize;
    if offset < c.bytes.len() {
        require!(c.bytes.get(offset..offset + bytes.len()) == Some(bytes.as_slice()), OracleError::Conflict);
        return Ok(());
    }
    require!(!c.sealed && offset == c.bytes.len() && offset + bytes.len() <= 4800, OracleError::Bounds);
    c.bytes.extend(bytes);
    Ok(())
}
pub fn seal_claim(ctx: Context<SealClaim>) -> Result<()> {
    let c = &mut ctx.accounts.claim;
    let value: wire::EvidenceClaim = decode(&c.bytes)?;
    require!(value.context.try_to_vec()? == context(&ctx.accounts.receiver, &ctx.accounts.epoch).try_to_vec()?, OracleError::Identity);
    require!(m(value.commitment())? == c.digest, OracleError::Identity);
    c.sealed = true;
    Ok(())
}
pub fn begin_snapshot_claim(ctx: Context<AuthOperation>) -> Result<()> {
    let s = &ctx.accounts.snapshot;
    active(&ctx.accounts.registry, s, s.key())?;
    require!(s.status == PRE, OracleError::State);
    let a = &mut ctx.accounts.auth;
    if a.started { return Ok(()); }
    let mut h = m(StreamingHash::new(wire::SNAPSHOT_DOMAIN))?;
    let previous = if s.predecessor == EMPTY { None } else { Some(s.predecessor.to_bytes()) };
    let slots: u32 = ctx.accounts.epoch.indicator_counts.iter().map(|n| *n as u32).sum();
    m(h.update(&context(&ctx.accounts.receiver, &ctx.accounts.epoch).try_to_vec()?))?;
    m(h.update(&s.key().to_bytes()))?; m(h.update(&s.precommitment))?;
    m(h.update(&previous.try_to_vec()?))?; m(h.update(&(s.cutoff as u64).to_le_bytes()))?;
    m(h.update(&slots.to_le_bytes()))?;
    a.claim_hash = h.try_to_vec()?; a.started = true;
    Ok(())
}
fn validate_claim_evidence(claim: &wire::EvidenceClaim, evidence: &math::Evidence) -> Result<()> {
    require!(claim.evidence_digest == m(math::evidence_digest(evidence))? && claim.metadata_digest == evidence.metadata_digest && claim.artifact_digests.contains(&evidence.artifact_digest), OracleError::Identity);
    let record = if claim.record_id.len() == 64 && claim.record_id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        let mut value = [0u8;32];
        for (i, pair) in claim.record_id.as_bytes().chunks_exact(2).enumerate() {
            let digit = |b: u8| if b.is_ascii_digit() { b - b'0' } else { b.to_ascii_lowercase() - b'a' + 10 };
            value[i] = digit(pair[0]) * 16 + digit(pair[1]);
        }
        value
    } else { math::artifact_digest(claim.record_id.as_bytes()) };
    require!(record == evidence.record_id, OracleError::Identity);
    Ok(())
}
pub fn bind_claim(ctx: Context<BindClaim>, country: u8, indicator: u8, comparison: bool) -> Result<()> {
    let a = &mut ctx.accounts.auth;
    let e = &ctx.accounts.epoch;
    require!((country as usize) < e.indicator_counts.len() && indicator < e.indicator_counts[country as usize], OracleError::Bounds);
    let ordinal = e.indicator_counts[..country as usize].iter().map(|v| *v as u16).sum::<u16>() + indicator as u16;
    
    let p = &ctx.accounts.page_account;
    require!(p.country == country && p.page == indicator / 8 && p.frozen, OracleError::Identity);
    let slot: math::Slot = decode(p.slots.get((indicator % 8) as usize).ok_or(OracleError::Bounds)?)?;
    let ev = if comparison { slot.comparison.as_ref().ok_or(OracleError::Identity)? } else { &slot.current };
    let claim: wire::EvidenceClaim = decode(&ctx.accounts.claim.bytes)?;
    require!(ctx.accounts.claim.sealed && ctx.accounts.assertion.claim_digest == ctx.accounts.claim.digest && !ctx.accounts.assertion.snapshot && ctx.accounts.assertion.outcome != 2, OracleError::Identity);
    validate_claim_evidence(&claim, ev)?;
    let binding = wire::EvidenceBinding { record_id: claim.record_id, evidence_digest: claim.evidence_digest, assessment_digest: claim.assessment_digest, assertion_id: ctx.accounts.assertion.id };
    let binding_digest = hash("continuous-bound-observation-v1", &(country, indicator, comparison, &binding))?;
    if ctx.accounts.binding.digest != [0;32] {
        require!(ctx.accounts.binding.digest == binding_digest, OracleError::Conflict);
        return Ok(());
    }
    require!(a.started && !a.frozen && a.appended_assertions == 0 && ctx.accounts.snapshot.status == PRE && !a.incident, OracleError::State);
    require!(a.slot_cursor == ordinal && a.comparison_next == comparison, OracleError::Order);
    ctx.accounts.binding.digest = binding_digest;
    if !comparison { update_hash(&mut a.claim_hash, &[country, indicator])?; }
    update_hash(&mut a.claim_hash, &binding.try_to_vec()?)?;
    if !comparison {
        update_hash(&mut a.claim_hash, &[u8::from(slot.comparison.is_some())])?;
        a.comparison_next = slot.comparison.is_some();
    } else { a.comparison_next = false; }
    if !a.comparison_next { a.slot_cursor += 1; }
    let member = &mut ctx.accounts.membership;
    if !member.used {
        member.proposal = a.key(); member.assertion = ctx.accounts.assertion.key(); member.used = true;
        a.unique_assertions += 1;
    }
    Ok(())
}
pub fn append_assertion(ctx: Context<MembershipOperation>) -> Result<()> {
    let a = &mut ctx.accounts.auth;
    let member = &mut ctx.accounts.membership;
    if member.appended { return Ok(()); }
    require!(!a.frozen && a.started && !a.comparison_next && a.slot_cursor as u32 == ctx.accounts.epoch.indicator_counts.iter().map(|v| *v as u32).sum::<u32>(), OracleError::Incomplete);
    require!(member.used && (a.appended_assertions == 0 || a.last_assertion < ctx.accounts.assertion.id), OracleError::Order);
    if a.appended_assertions == 0 {
        let mut set = m(StreamingHash::new(wire::ASSERTIONS_DOMAIN))?;
        m(set.update(&a.unique_assertions.to_le_bytes()))?;
        a.set_hash = set.try_to_vec()?;
        let count = a.unique_assertions.to_le_bytes(); update_hash(&mut a.claim_hash, &count)?;
    }
    update_hash(&mut a.claim_hash, &ctx.accounts.assertion.id)?;
    update_hash(&mut a.set_hash, &ctx.accounts.assertion.id)?;
    a.last_assertion = ctx.accounts.assertion.id; a.appended_assertions += 1; member.appended = true;
    Ok(())
}
pub fn seal_snapshot_claim(ctx: Context<AuthOperation>) -> Result<()> {
    let a = &mut ctx.accounts.auth;
    require!(a.unique_assertions > 0 && a.appended_assertions == a.unique_assertions, OracleError::Incomplete);
    a.claim_digest = m(load_hash(&a.claim_hash)?.finish())?; a.frozen = true;
    Ok(())
}
pub fn audit_assertion(ctx: Context<MembershipOperation>) -> Result<()> {
    let a = &mut ctx.accounts.auth;
    let member = &mut ctx.accounts.membership;
    require!(a.frozen && member.appended && ctx.accounts.assertion.outcome == 1, OracleError::Incomplete);
    if !member.audited { member.audited = true; a.audited_assertions += 1; }
    Ok(())
}
pub fn receive_relay(ctx: Context<ReceiveRelay>, event_number: u64) -> Result<()> {
    let c = &ctx.accounts.receiver;
    let s = &ctx.accounts.snapshot;
    let d = math::relay::RelayDestination {
        wormhole_program: c.settings.wormhole_program.to_bytes(), evm_chain_id: c.settings.evm_chain_id,
        wormhole_chain: c.settings.wormhole_chain, emitter: c.settings.emitter, adapter: c.settings.adapter,
        uma: c.settings.uma, program: crate::ID.to_bytes(), registry: c.registry.to_bytes(), epoch: ctx.accounts.epoch.id,
        proposal: s.key().to_bytes(), precommitment: s.precommitment, consistency_level: c.settings.consistency_level,
    };
    require!(s.status != DRAFT, OracleError::State);
    let vaa = ctx.accounts.posted_vaa.try_borrow_data()?;
    let verified = m(math::relay::verify_posted_relay(ctx.accounts.posted_vaa.owner.to_bytes(), &vaa, &d))?;
    require!(verified.message.header.event_number == event_number, OracleError::Identity);
    let digest = m(verified.message.commitment())?;
    let receipt = &mut ctx.accounts.receipt;
    if receipt.proposal != EMPTY {
        if receipt.digest != digest { incident(&mut ctx.accounts.registry, &mut ctx.accounts.auth, event_number, receipt.digest, digest); }
        return Ok(());
    }
    receipt.proposal = ctx.accounts.auth.key(); receipt.event_number = event_number;
    receipt.digest = digest; receipt.wormhole_sequence = verified.wormhole_sequence;
    receipt.bytes = m(verified.message.encode())?;
    if matches!(s.status, POST | CALCULATING | PUBLISHED | CANCELLED | EXPIRED) || s.closed { incident(&mut ctx.accounts.registry, &mut ctx.accounts.auth, event_number, [0;32], digest); }
    Ok(())
}
pub fn precommit_authenticated(ctx: Context<AuthOperation>) -> Result<()> {
    let s = &mut ctx.accounts.snapshot;
    active(&ctx.accounts.registry, s, s.key())?;
    if s.status == PRE { return Ok(()); }
    require!(s.status == DRAFT && s.frozen_pages == total_pages(&ctx.accounts.epoch), OracleError::Incomplete);
    s.deadline = 0;
    s.precommitment = hash("precommit", &(s.evidence_digest, s.deadline, s.adapter))?;
    s.status = PRE;
    Ok(())
}
fn assertion_id(bytes: &[u8]) -> Result<[u8;32]> {
    let message = m(math::relay::decode_relay(bytes))?;
    Ok(match message.event {
        RelayEvent::Registered { assertion_id, .. } | RelayEvent::Disputed { assertion_id, .. } | RelayEvent::Settled { assertion_id, .. } => assertion_id,
        RelayEvent::Closed { .. } => [0;32],
    })
}
fn history<'a, 'info>(value: &'a mut Option<Account<'info, EvidenceHistory>>, evidence: [u8;32]) -> Result<&'a mut Account<'info, EvidenceHistory>> {
    let h = value.as_mut().ok_or(OracleError::Incomplete)?;
    require_keys_eq!(h.key(), Pubkey::find_program_address(&[b"history", &evidence], &crate::ID).0, OracleError::Identity);
    require!(h.digest == evidence, OracleError::Identity);
    Ok(h)
}
pub fn apply_relay(ctx: Context<ApplyRelay>) -> Result<()> {
    let receipt = &mut ctx.accounts.receipt;
    if receipt.applied { return Ok(()); }
    let a = &mut ctx.accounts.auth;
    require!(!a.incident && receipt.event_number == a.applied_events + 1, OracleError::Order);
    let message = m(math::relay::decode_relay(&receipt.bytes))?;
    let s = &mut ctx.accounts.snapshot;
    if matches!(s.status, POST | CALCULATING | PUBLISHED | CANCELLED | EXPIRED) || s.closed {
        incident(&mut ctx.accounts.registry, a, receipt.event_number, [0;32], receipt.digest);
        return Ok(());
    }
    let assertion = &mut ctx.accounts.assertion;
    let now = Clock::get()?.unix_timestamp;
    match &message.event {
        RelayEvent::Registered { uma: _, assertion_id: id, claim_kind, claim_digest, subject, start, deadline } => {
            require!(*claim_digest == *subject && *start <= now as u64 && *id != [0;32], OracleError::Identity);
            let is_snapshot = matches!(claim_kind, ClaimKind::Snapshot);
            let evidence = if is_snapshot {
                require!(a.frozen && a.claim_digest == *claim_digest, OracleError::Identity);
                [0;32]
            } else {
                let c = ctx.accounts.claim.as_ref().ok_or(OracleError::Incomplete)?;
                require!(c.sealed && c.receiver == ctx.accounts.receiver.key() && c.digest == *claim_digest, OracleError::Identity);
                decode::<wire::EvidenceClaim>(&c.bytes)?.evidence_digest
            };
            if assertion.receiver != EMPTY {
                if assertion.receiver != ctx.accounts.receiver.key() || assertion.id != *id || assertion.claim_digest != *claim_digest || assertion.start != *start || assertion.deadline != *deadline || assertion.snapshot != is_snapshot {
                    incident(&mut ctx.accounts.registry, a, receipt.event_number, assertion.claim_digest, *claim_digest);
                    return Ok(());
                }
            } else {
                assertion.receiver = ctx.accounts.receiver.key(); assertion.id = *id; assertion.claim_digest = *claim_digest;
                assertion.evidence_digest = evidence; assertion.snapshot = is_snapshot; assertion.start = *start; assertion.deadline = *deadline;
            }
            if is_snapshot {
                if a.snapshot_assertion != [0;32] && a.snapshot_assertion != *id {
                    let expected = a.snapshot_assertion;
                    incident(&mut ctx.accounts.registry, a, receipt.event_number, expected, *id);
                    return Ok(());
                }
                if a.snapshot_assertion == [0;32] {
                    update_hash(&mut a.set_hash, id)?;
                    a.assertion_set_digest = m(load_hash(&a.set_hash)?.finish())?;
                    a.snapshot_assertion = *id;
                }
            }
            s.deadline = s.deadline.max(*deadline as i64);
        },
        RelayEvent::Disputed { assertion_id: id, subject, dispute_id } => {
            require!(assertion.receiver == ctx.accounts.receiver.key() && assertion.id == *id && assertion.claim_digest == *subject, OracleError::Identity);
            if assertion.outcome != 0 || (assertion.disputed && assertion.dispute_id != *dispute_id) {
                incident(&mut ctx.accounts.registry, a, receipt.event_number, assertion.dispute_id, *dispute_id);
                return Ok(());
            }
            if !assertion.disputed {
                assertion.disputed = true; assertion.dispute_id = *dispute_id;
                if !assertion.snapshot {
                    let h = history(&mut ctx.accounts.history, assertion.evidence_digest)?;
                    h.pending = h.pending.checked_add(1).ok_or(OracleError::Overflow)?;
                    ctx.accounts.registry.history_digest = hash("authenticated-history", &(ctx.accounts.registry.history_digest, assertion.key(), 0u8))?;
                }
            }
        },
        RelayEvent::Settled { assertion_id: id, subject, accepted, disputed, settled_at } => {
            require!(assertion.receiver == ctx.accounts.receiver.key() && assertion.id == *id && assertion.claim_digest == *subject, OracleError::Identity);
            require!(*settled_at >= assertion.deadline && *settled_at <= now as u64, OracleError::Time);
            let outcome = if *accepted { 1 } else { 2 };
            if assertion.disputed != *disputed || (assertion.outcome != 0 && assertion.outcome != outcome) {
                incident(&mut ctx.accounts.registry, a, receipt.event_number, assertion.claim_digest, receipt.digest);
                return Ok(());
            }
            if assertion.outcome == 0 {
                assertion.outcome = outcome;
                if assertion.snapshot {
                    require!(a.snapshot_assertion == *id, OracleError::Identity);
                    a.snapshot_accepted = *accepted;
                } else {
                    let h = history(&mut ctx.accounts.history, assertion.evidence_digest)?;
                    if *disputed {
                        h.pending = h.pending.checked_sub(1).ok_or(OracleError::State)?;
                        if *accepted { h.rejected = h.rejected.checked_add(1).ok_or(OracleError::Overflow)?; }
                    }
                    if !*accepted { h.invalid = true; }
                    ctx.accounts.registry.history_digest = hash("authenticated-history", &(ctx.accounts.registry.history_digest, assertion.key(), outcome))?;
                }
            }
            if !*accepted {
                s.status = REJECTED;
                if ctx.accounts.registry.active == s.key() { ctx.accounts.registry.active = EMPTY; }
            }
        },
        RelayEvent::Closed { assertion_set_digest, event_count, event_digest, accepted } => {
            require!(a.frozen && a.snapshot_assertion != [0;32], OracleError::Incomplete);
            if a.assertion_set_digest != *assertion_set_digest || a.applied_events != *event_count || a.event_digest != *event_digest {
                let expected = a.event_digest;
                incident(&mut ctx.accounts.registry, a, receipt.event_number, expected, *event_digest);
                return Ok(());
            }
            if *accepted {
                require!(s.status == PRE && a.snapshot_accepted && a.audited_assertions == a.unique_assertions, OracleError::Incomplete);
            } else { require!(s.status == REJECTED, OracleError::State); }
            s.closed = true;
        },
    }
    if !matches!(message.event, RelayEvent::Closed { .. }) {
        a.event_digest = m(wire::event_history_digest(a.event_digest, &message))?;
    }
    a.applied_events += 1;
    s.event_count = match message.event { RelayEvent::Closed { event_count, .. } => event_count, _ => a.applied_events };
    s.event_digest = a.event_digest;
    receipt.applied = true;
    Ok(())
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateReceiver<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(init,payer=authority,space=384,seeds=[b"receiver",registry.key().as_ref(),&id.to_le_bytes()],bump)]
    pub receiver: Account<'info, ReceiverConfig>,
    #[account(init_if_needed,payer=authority,space=104,seeds=[b"epoch-auth",epoch.key().as_ref()],bump)]
    pub epoch_auth: Account<'info, EpochAuthentication>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct PinReceiver<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(has_one=registry,has_one=epoch)]
    pub receiver: Account<'info, ReceiverConfig>,
    #[account(mut,has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(init,payer=authority,space=640,seeds=[b"authenticated",snapshot.key().as_ref()],bump)]
    pub auth: Account<'info, AuthenticatedProposal>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(digest: [u8;32])]
pub struct UploadClaim<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub receiver: Account<'info, ReceiverConfig>,
    #[account(init_if_needed,payer=authority,space=4900,seeds=[b"claim",receiver.key().as_ref(),&digest],bump)]
    pub claim: Account<'info, AuthenticatedClaim>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SealClaim<'info> {
    pub epoch: Account<'info, Epoch>,
    #[account(has_one=epoch)]
    pub receiver: Account<'info, ReceiverConfig>,
    #[account(mut,has_one=receiver,seeds=[b"claim",receiver.key().as_ref(),&claim.digest],bump)]
    pub claim: Account<'info, AuthenticatedClaim>,
}
#[derive(Accounts)]
pub struct AuthOperation<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(has_one=registry,has_one=epoch)]
    pub receiver: Account<'info, ReceiverConfig>,
    #[account(mut,has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(mut,has_one=snapshot,has_one=receiver,seeds=[b"authenticated",snapshot.key().as_ref()],bump)]
    pub auth: Account<'info, AuthenticatedProposal>,
    pub authority: Signer<'info>,
}
#[derive(Accounts)]
#[instruction(country:u8,indicator:u8,comparison:bool)]
pub struct BindClaim<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(has_one=registry,has_one=epoch)]
    pub receiver: Account<'info, ReceiverConfig>,
    #[account(mut,has_one=snapshot,has_one=receiver,seeds=[b"authenticated",snapshot.key().as_ref()],bump)]
    pub auth: Account<'info, AuthenticatedProposal>,
    #[account(has_one=snapshot)]
    pub page_account: Account<'info, EvidencePage>,
    #[account(has_one=receiver)]
    pub claim: Account<'info, AuthenticatedClaim>,
    #[account(has_one=receiver)]
    pub assertion: Account<'info, AuthenticatedAssertion>,
    #[account(init_if_needed,payer=authority,space=80,seeds=[b"membership",auth.key().as_ref(),assertion.key().as_ref()],bump)]
    pub membership: Account<'info, AssertionMembership>,
    #[account(init_if_needed,payer=authority,space=40,seeds=[b"binding",auth.key().as_ref(),&[country],&[indicator],&[comparison as u8]],bump)]
    pub binding: Account<'info, BoundClaim>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct MembershipOperation<'info> {
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(seeds=[b"registry"],bump)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(has_one=registry,has_one=epoch)]
    pub receiver: Account<'info, ReceiverConfig>,
    #[account(mut,has_one=snapshot,has_one=receiver,seeds=[b"authenticated",snapshot.key().as_ref()],bump)]
    pub auth: Account<'info, AuthenticatedProposal>,
    #[account(has_one=receiver)]
    pub assertion: Account<'info, AuthenticatedAssertion>,
    #[account(mut,has_one=assertion,constraint=membership.proposal==auth.key(),seeds=[b"membership",auth.key().as_ref(),assertion.key().as_ref()],bump)]
    pub membership: Account<'info, AssertionMembership>,
}
#[derive(Accounts)]
#[instruction(event_number: u64)]
pub struct ReceiveRelay<'info> {
    #[account(mut,seeds=[b"registry"],bump)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(has_one=registry,has_one=epoch)]
    pub receiver: Account<'info, ReceiverConfig>,
    #[account(mut,has_one=snapshot,has_one=receiver,seeds=[b"authenticated",snapshot.key().as_ref()],bump)]
    pub auth: Account<'info, AuthenticatedProposal>,
    #[account(owner=receiver.settings.wormhole_program)]
    pub posted_vaa: UncheckedAccount<'info>,
    #[account(init_if_needed,payer=payer,space=640,seeds=[b"relay",auth.key().as_ref(),&event_number.to_le_bytes()],bump)]
    pub receipt: Account<'info, AuthenticatedRelayReceipt>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ApplyRelay<'info> {
    #[account(mut,seeds=[b"registry"],bump)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut,has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(has_one=registry,has_one=epoch)]
    pub receiver: Account<'info, ReceiverConfig>,
    #[account(mut,has_one=snapshot,has_one=receiver,seeds=[b"authenticated",snapshot.key().as_ref()],bump)]
    pub auth: Account<'info, AuthenticatedProposal>,
    #[account(mut,constraint=receipt.proposal==auth.key(),seeds=[b"relay",auth.key().as_ref(),&receipt.event_number.to_le_bytes()],bump)]
    pub receipt: Account<'info, AuthenticatedRelayReceipt>,
    #[account(init_if_needed,payer=payer,space=256,seeds=[b"assertion".as_ref(),&receiver.settings.evm_chain_id.to_le_bytes(),&receiver.settings.uma,&assertion_id(&receipt.bytes)?],bump)]
    pub assertion: Account<'info, AuthenticatedAssertion>,
    pub claim: Option<Account<'info, AuthenticatedClaim>>,
    #[account(mut)]
    pub history: Option<Account<'info, EvidenceHistory>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
