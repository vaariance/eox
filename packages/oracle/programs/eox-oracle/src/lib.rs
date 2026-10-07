use anchor_lang::prelude::*;
use eox_oracle_math as math;

declare_id!("D1HhP4kVA73bj6c4MfX5yzMZDvQRx5DTRP3xpC2YCe85");
const EMPTY: Pubkey = Pubkey::new_from_array([0; 32]);
const DRAFT: u8 = 0;
const PRE: u8 = 1;
const POST: u8 = 2;
const CALCULATING: u8 = 3;
const PUBLISHED: u8 = 4;
const REJECTED: u8 = 5;
const CANCELLED: u8 = 6;
const EXPIRED: u8 = 7;
fn m<T>(r: math::Result<T>) -> Result<T> {
    r.map_err(|_| error!(OracleError::Math))
}
fn decode<T: AnchorDeserialize>(bytes: &[u8]) -> Result<T> {
    T::try_from_slice(bytes).map_err(|_| error!(OracleError::Encoding))
}
fn hash<T: AnchorSerialize>(domain: &str, x: &T) -> Result<[u8; 32]> {
    m(math::digest(domain, x))
}
fn page_count(n: u8) -> u8 {
    n.div_ceil(8)
}
fn expected_slots(e: &Epoch, c: u8, p: u8) -> Result<usize> {
    let n = *e
        .indicator_counts
        .get(c as usize)
        .ok_or(OracleError::Bounds)?;
    require!(p < page_count(n), OracleError::Bounds);
    Ok((n - p * 8).min(8) as usize)
}
fn order(e: &Epoch, c: u8, p: u8) -> Result<u16> {
    expected_slots(e, c, p)?;
    Ok(e.indicator_counts[..c as usize]
        .iter()
        .map(|n| page_count(*n) as u16)
        .sum::<u16>()
        + p as u16)
}
fn total_pages(e: &Epoch) -> u16 {
    e.indicator_counts
        .iter()
        .map(|n| page_count(*n) as u16)
        .sum()
}
fn active(r: &Registry, s: &Snapshot, key: Pubkey) -> Result<()> {
    require!(!r.paused, OracleError::Paused);
    require_keys_eq!(r.active, key, OracleError::State);
    require!(s.status < PUBLISHED, OracleError::State);
    Ok(())
}
fn country_result(x: &CountryOutput) -> math::CountryResult {
    math::CountryResult {
        state: x.state,
        confidence: x.confidence,
        saturated: x.saturated,
        stale: x.stale,
    }
}

#[program]
pub mod eox_oracle {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, adapter: Pubkey) -> Result<()> {
        require!(
            adapter != ctx.accounts.authority.key() && adapter != EMPTY,
            OracleError::Authority
        );
        let r = &mut ctx.accounts.registry;
        r.authority = ctx.accounts.authority.key();
        r.adapter = adapter;
        Ok(())
    }
    pub fn set_pause(ctx: Context<Admin>, paused: bool) -> Result<()> {
        ctx.accounts.registry.paused = paused;
        Ok(())
    }
    pub fn create_epoch(
        ctx: Context<CreateEpoch>,
        id: u64,
        countries: Vec<[u8; 2]>,
        indicator_counts: Vec<u8>,
        multiplier: u16,
    ) -> Result<()> {
        require!(
            !ctx.accounts.registry.paused && ctx.accounts.registry.active == EMPTY,
            OracleError::State
        );
        require!(
            (2..=30).contains(&countries.len())
                && countries.len() == indicator_counts.len()
                && (1..=100).contains(&multiplier),
            OracleError::Bounds
        );
        for (i, c) in countries.iter().enumerate() {
            require!(!countries[..i].contains(c), OracleError::Bounds);
        }
        require!(
            indicator_counts.iter().all(|n| (1..=32).contains(n)),
            OracleError::Bounds
        );
        let e = &mut ctx.accounts.epoch;
        e.id = id;
        e.countries = countries;
        e.indicator_counts = indicator_counts;
        e.multiplier = multiplier;
        e.registry = ctx.accounts.registry.key();
        e.configuration_digest = hash(
            "epoch",
            &(
                crate::ID,
                e.key(),
                id,
                &e.countries,
                &e.indicator_counts,
                multiplier,
            ),
        )?;
        Ok(())
    }
    pub fn append_rule(
        ctx: Context<AppendRule>,
        country: u8,
        page: u8,
        rule: Vec<u8>,
    ) -> Result<()> {
        let e = &mut ctx.accounts.epoch;
        require!(!e.sealed, OracleError::State);
        require!(rule.len() <= 192, OracleError::Bounds);
        let r: math::Rule = decode(&rule)?;
        m(math::validate_rule(&r))?;
        let expected = expected_slots(e, country, page)?;
        let pos = order(e, country, page)?;
        let p = &mut ctx.accounts.rules;
        if p.rules.is_empty() {
            p.epoch = e.key();
            p.country = country;
            p.page = page;
        }
        require!(
            p.rules.len() < expected && pos == e.rule_pages,
            OracleError::Order
        );
        e.configuration_digest = hash(
            "rule",
            &(
                e.configuration_digest,
                country,
                page,
                p.rules.len() as u8,
                &rule,
            ),
        )?;
        p.rules.push(rule);
        if p.rules.len() == expected {
            e.rule_pages += 1;
        }
        Ok(())
    }
    pub fn seal_epoch(ctx: Context<EpochAdmin>) -> Result<()> {
        let e = &mut ctx.accounts.epoch;
        require!(e.rule_pages == total_pages(e), OracleError::Incomplete);
        e.sealed = true;
        Ok(())
    }
    pub fn create_snapshot(ctx: Context<CreateSnapshot>, sequence: u64, cutoff: i64) -> Result<()> {
        let r = &mut ctx.accounts.registry;
        require!(!r.paused && r.active == EMPTY, OracleError::State);
        let e = &ctx.accounts.epoch;
        require!(e.sealed, OracleError::State);
        require!(sequence == r.next_sequence, OracleError::Order);
        let now = Clock::get()?.unix_timestamp;
        require!(cutoff >= 0 && cutoff <= now, OracleError::Time);
        let s = &mut ctx.accounts.snapshot;
        s.epoch = e.key();
        s.registry = r.key();
        s.sequence = sequence;
        s.cutoff = cutoff;
        s.predecessor = r.latest;
        s.adapter = r.adapter;
        s.evidence_digest = hash(
            "snapshot",
            &(
                crate::ID,
                s.key(),
                e.key(),
                e.configuration_digest,
                sequence,
                r.latest,
                cutoff,
            ),
        )?;
        s.countries = vec![CountryOutput::default(); e.countries.len()];
        r.active = s.key();
        r.next_sequence = r
            .next_sequence
            .checked_add(1)
            .ok_or(OracleError::Overflow)?;
        Ok(())
    }
    pub fn initialize_history(ctx: Context<InitializeHistory>, evidence: Vec<u8>) -> Result<()> {
        require!(evidence.len() <= 320, OracleError::Bounds);
        let e: math::Evidence = decode(&evidence)?;
        let digest = m(math::evidence_digest(&e))?;
        require_keys_eq!(
            ctx.accounts.history.key(),
            Pubkey::find_program_address(&[b"history", &digest], &crate::ID).0,
            OracleError::Identity
        );
        let h = &mut ctx.accounts.history;
        if h.digest == [0; 32] {
            h.digest = digest;
        } else {
            require!(h.digest == digest, OracleError::Identity);
        }
        Ok(())
    }
    pub fn upload_slot(
        ctx: Context<UploadSlot>,
        country: u8,
        page: u8,
        index: u8,
        slot: Vec<u8>,
    ) -> Result<()> {
        let s = &ctx.accounts.snapshot;
        active(&ctx.accounts.registry, s, s.key())?;
        require!(s.status == DRAFT, OracleError::State);
        require!(slot.len() <= 640, OracleError::Bounds);
        let expected = expected_slots(&ctx.accounts.epoch, country, page)?;
        let rules = &ctx.accounts.rules;
        require!(rules.rules.len() == expected, OracleError::Incomplete);
        let rule: math::Rule = decode(rules.rules.get(index as usize).ok_or(OracleError::Bounds)?)?;
        let value: math::Slot = decode(&slot)?;
        m(math::validate_slot(&rule, &value, s.cutoff))?;
        let p = &mut ctx.accounts.page_account;
        if p.slots.is_empty() {
            p.snapshot = s.key();
            p.country = country;
            p.page = page;
        }
        require!(!p.frozen, OracleError::State);
        if (index as usize) < p.slots.len() {
            require!(p.slots[index as usize] == slot, OracleError::Conflict);
            return Ok(());
        }
        require!(
            index as usize == p.slots.len() && p.slots.len() < expected,
            OracleError::Order
        );
        p.slots.push(slot);
        Ok(())
    }
    pub fn freeze_page(ctx: Context<PageOperation>, country: u8, page: u8) -> Result<()> {
        let e = &ctx.accounts.epoch;
        let s = &mut ctx.accounts.snapshot;
        active(&ctx.accounts.registry, s, s.key())?;
        require!(s.status == DRAFT, OracleError::State);
        let p = &mut ctx.accounts.page_account;
        if p.frozen {
            return Ok(());
        }
        require!(
            p.slots.len() == expected_slots(e, country, page)?
                && order(e, country, page)? == s.frozen_pages,
            OracleError::Order
        );
        s.evidence_digest = hash(
            "evidence-page",
            &(s.evidence_digest, country, page, &p.slots),
        )?;
        p.frozen = true;
        s.frozen_pages += 1;
        Ok(())
    }
    pub fn precommit(ctx: Context<SnapshotOperation>) -> Result<()> {
        let s = &mut ctx.accounts.snapshot;
        active(&ctx.accounts.registry, s, s.key())?;
        if s.status == PRE {
            return Ok(());
        }
        require!(
            s.status == DRAFT && s.frozen_pages == total_pages(&ctx.accounts.epoch),
            OracleError::Incomplete
        );
        s.status = PRE;
        s.deadline = Clock::get()?
            .unix_timestamp
            .checked_add(60)
            .ok_or(OracleError::Overflow)?;
        s.precommitment = hash("precommit", &(s.evidence_digest, s.deadline, s.adapter))?;
        Ok(())
    }
    pub fn register_challenge(
        ctx: Context<RegisterChallenge>,
        id: [u8; 32],
        evidence: [u8; 32],
        slot_index: u8,
        comparison: bool,
    ) -> Result<()> {
        let s = &mut ctx.accounts.snapshot;
        active(&ctx.accounts.registry, s, s.key())?;
        require!(s.status == PRE && !s.closed, OracleError::State);
        let slot: math::Slot = decode(
            ctx.accounts
                .page_account
                .slots
                .get(slot_index as usize)
                .ok_or(OracleError::Bounds)?,
        )?;
        let ev = if comparison {
            slot.comparison.as_ref().ok_or(OracleError::Identity)?
        } else {
            &slot.current
        };
        require!(
            m(math::evidence_digest(ev))? == evidence,
            OracleError::Identity
        );
        let c = &mut ctx.accounts.challenge;
        if c.snapshot != EMPTY {
            require!(
                c.snapshot == s.key() && c.evidence == evidence && c.id == id,
                OracleError::Conflict
            );
            return Ok(());
        }
        require!(
            Clock::get()?.unix_timestamp <= s.deadline,
            OracleError::Time
        );
        c.snapshot = s.key();
        c.evidence = evidence;
        c.id = id;
        c.outcome = 0;
        ctx.accounts.history.pending = ctx
            .accounts
            .history
            .pending
            .checked_add(1)
            .ok_or(OracleError::Overflow)?;
        s.pending += 1;
        s.event_digest = hash("challenge-event", &(s.event_digest, id, evidence, 0u8))?;
        s.event_count += 1;
        ctx.accounts.registry.history_digest = hash(
            "global-challenge-history",
            &(
                ctx.accounts.registry.history_digest,
                s.key(),
                s.event_digest,
            ),
        )?;
        Ok(())
    }
    pub fn resolve_challenge(ctx: Context<ResolveChallenge>, invalid: bool) -> Result<()> {
        let s = &mut ctx.accounts.snapshot;
        let c = &mut ctx.accounts.challenge;
        let outcome = if invalid { 2 } else { 1 };
        if c.outcome != 0 {
            if c.outcome == outcome {
                return Ok(());
            }
            ctx.accounts.registry.paused = true;
            emit!(AdapterInconsistency {
                snapshot: s.key(),
                challenge: c.id
            });
            return Ok(());
        }
        require!(
            (s.status == PRE || s.status == REJECTED) && !s.closed,
            OracleError::State
        );
        require!(
            ctx.accounts.history.pending > 0 && s.pending > 0,
            OracleError::State
        );
        c.outcome = outcome;
        ctx.accounts.history.pending -= 1;
        s.pending -= 1;
        if invalid {
            ctx.accounts.history.invalid = true;
            s.status = REJECTED;
        } else {
            ctx.accounts.history.rejected = ctx
                .accounts
                .history
                .rejected
                .checked_add(1)
                .ok_or(OracleError::Overflow)?;
        }
        s.event_digest = hash(
            "challenge-event",
            &(s.event_digest, c.id, c.evidence, outcome),
        )?;
        s.event_count += 1;
        ctx.accounts.registry.history_digest = hash(
            "global-challenge-history",
            &(
                ctx.accounts.registry.history_digest,
                s.key(),
                s.event_digest,
            ),
        )?;
        Ok(())
    }
    pub fn close_window(ctx: Context<AdapterSnapshot>, count: u64, digest: [u8; 32]) -> Result<()> {
        let s = &mut ctx.accounts.snapshot;
        require!(s.status == PRE || s.status == REJECTED, OracleError::State);
        require!(
            Clock::get()?.unix_timestamp >= s.deadline,
            OracleError::Time
        );
        require!(
            s.pending == 0 && s.event_count == count && s.event_digest == digest,
            OracleError::Incomplete
        );
        s.closed = true;
        if s.status == REJECTED && ctx.accounts.registry.active == s.key() {
            ctx.accounts.registry.active = EMPTY;
        }
        Ok(())
    }
    pub fn postcommit(ctx: Context<SnapshotOperation>) -> Result<()> {
        let s = &mut ctx.accounts.snapshot;
        active(&ctx.accounts.registry, s, s.key())?;
        if s.status == POST {
            return Ok(());
        }
        require!(
            s.status == PRE && s.closed && s.pending == 0,
            OracleError::Incomplete
        );
        s.evaluation_time = Clock::get()?.unix_timestamp;
        s.postcommitment = hash(
            "postcommit",
            &(
                s.precommitment,
                s.evidence_digest,
                s.event_digest,
                ctx.accounts.registry.history_digest,
                s.evaluation_time,
            ),
        )?;
        s.status = POST;
        Ok(())
    }
    pub fn calculate_page(ctx: Context<PageOperation>, country: u8, page: u8) -> Result<()> {
        let s = &mut ctx.accounts.snapshot;
        active(&ctx.accounts.registry, s, s.key())?;
        require!(
            s.status == POST || s.status == CALCULATING,
            OracleError::State
        );
        require!(
            Clock::get()?.unix_timestamp <= s.evaluation_time + 3600,
            OracleError::Time
        );
        let p = &mut ctx.accounts.page_account;
        if p.calculated {
            return Ok(());
        }
        require!(
            p.frozen && order(&ctx.accounts.epoch, country, page)? == s.calculated_pages,
            OracleError::Order
        );
        let evaluation_time = s.evaluation_time;
        let mut cursor = 0;
        let out = &mut s.countries[country as usize];
        for (raw, rule) in p.slots.iter().zip(&ctx.accounts.rules.rules) {
            let slot: math::Slot = decode(raw)?;
            let rule: math::Rule = decode(rule)?;
            let current = read_history(ctx.remaining_accounts, &mut cursor, &slot.current)?;
            let comparison = if let Some(e) = &slot.comparison {
                read_history(ctx.remaining_accounts, &mut cursor, e)?
            } else {
                math::History::default()
            };
            let result = m(math::calculate_indicator(
                &rule,
                &slot,
                evaluation_time,
                &current,
                &comparison,
            ))?;
            out.normalized_sum += result.normalized as i128 * rule.weight as i128;
            out.confidence_sum += result.confidence as i128 * rule.weight as i128;
            out.weight_sum += rule.weight as u64;
            out.saturated |= result.saturated;
            out.stale |= result.stale;
        }
        require!(cursor == ctx.remaining_accounts.len(), OracleError::Bounds);
        p.calculated = true;
        if page + 1 == page_count(ctx.accounts.epoch.indicator_counts[country as usize]) {
            out.state = 100 * math::SCALE
                + 50 * i64::try_from(m(math::rounded_div(
                    out.normalized_sum,
                    out.weight_sum as i128,
                ))?)
                .map_err(|_| OracleError::Overflow)?;
            out.confidence = i64::try_from(m(math::rounded_div(
                out.confidence_sum,
                out.weight_sum as i128,
            ))?)
            .map_err(|_| OracleError::Overflow)?;
            out.complete = true;
        }
        s.calculated_pages += 1;
        s.status = CALCULATING;
        Ok(())
    }
    pub fn publish(ctx: Context<Publish>) -> Result<()> {
        let s = &mut ctx.accounts.snapshot;
        if s.status == PUBLISHED {
            return Ok(());
        }
        active(&ctx.accounts.registry, s, s.key())?;
        require!(
            s.status == CALCULATING && s.countries.iter().all(|c| c.complete),
            OracleError::Incomplete
        );
        require!(
            Clock::get()?.unix_timestamp <= s.evaluation_time + 3600,
            OracleError::Time
        );
        require_keys_eq!(
            ctx.accounts.registry.latest,
            s.predecessor,
            OracleError::Predecessor
        );
        let e = &mut ctx.accounts.epoch;
        let countries: Vec<_> = s.countries.iter().map(country_result).collect();
        let world = m(math::world(&countries))?;
        if e.baseline.is_empty() {
            e.baseline = countries.iter().map(|c| c.state).collect();
            e.baseline_world = world.state;
            e.baseline_snapshot = s.key();
        }
        s.world = world.state;
        s.world_confidence = world.confidence;
        for (i, c) in s.countries.iter_mut().enumerate() {
            let r = m(math::reference(
                &countries[i],
                &world,
                e.baseline[i],
                e.baseline_world,
                e.multiplier,
            ))?;
            c.ratio = r.ratio;
            c.change = r.change;
            c.expressed = r.expressed;
            c.reference_confidence = r.confidence;
        }
        s.status = PUBLISHED;
        s.published_at = Clock::get()?.unix_timestamp;
        ctx.accounts.registry.latest = s.key();
        ctx.accounts.registry.active = EMPTY;
        emit!(ReferencePublished {
            snapshot: s.key(),
            epoch: e.key(),
            sequence: s.sequence,
            evidence_cutoff: s.cutoff,
            evaluation_time: s.evaluation_time,
            postcommitment: s.postcommitment
        });
        Ok(())
    }
    pub fn read_pair(ctx: Context<ReadPair>, base: u8, quote: u8) -> Result<()> {
        let s = &ctx.accounts.snapshot;
        let e = &ctx.accounts.epoch;
        require!(s.status == PUBLISHED, OracleError::State);
        let a = s.countries.get(base as usize).ok_or(OracleError::Bounds)?;
        let b = s.countries.get(quote as usize).ok_or(OracleError::Bounds)?;
        let r = m(math::reference(
            &country_result(a),
            &country_result(b),
            e.baseline[base as usize],
            e.baseline[quote as usize],
            e.multiplier,
        ))?;
        anchor_lang::solana_program::program::set_return_data(&r.try_to_vec()?);
        Ok(())
    }
    pub fn cancel(ctx: Context<SnapshotOperation>) -> Result<()> {
        let s = &mut ctx.accounts.snapshot;
        require!(s.status < PUBLISHED && s.pending == 0, OracleError::State);
        s.status = CANCELLED;
        if ctx.accounts.registry.active == s.key() {
            ctx.accounts.registry.active = EMPTY;
        }
        Ok(())
    }
    pub fn expire(ctx: Context<SnapshotOperation>) -> Result<()> {
        let s = &mut ctx.accounts.snapshot;
        require!(
            (s.status == POST || s.status == CALCULATING)
                && Clock::get()?.unix_timestamp > s.evaluation_time + 3600,
            OracleError::Time
        );
        s.status = EXPIRED;
        if ctx.accounts.registry.active == s.key() {
            ctx.accounts.registry.active = EMPTY;
        }
        Ok(())
    }
}
fn read_history(
    accounts: &[AccountInfo],
    cursor: &mut usize,
    e: &math::Evidence,
) -> Result<math::History> {
    let digest = m(math::evidence_digest(e))?;
    let info = accounts.get(*cursor).ok_or(OracleError::Incomplete)?;
    *cursor += 1;
    require_keys_eq!(*info.owner, crate::ID, OracleError::Identity);
    require_keys_eq!(
        info.key(),
        Pubkey::find_program_address(&[b"history", &digest], &crate::ID).0,
        OracleError::Identity
    );
    let data = info.try_borrow_data()?;
    let h = EvidenceHistory::try_deserialize(&mut &data[..])?;
    require!(
        h.digest == digest && !h.invalid && h.pending == 0,
        OracleError::Disputed
    );
    Ok(math::History {
        pending: h.pending,
        rejected: h.rejected,
    })
}

#[account]
pub struct Registry {
    pub authority: Pubkey,
    pub adapter: Pubkey,
    pub paused: bool,
    pub active: Pubkey,
    pub latest: Pubkey,
    pub next_sequence: u64,
    pub history_digest: [u8; 32],
}
#[account]
pub struct Epoch {
    pub registry: Pubkey,
    pub id: u64,
    pub countries: Vec<[u8; 2]>,
    pub indicator_counts: Vec<u8>,
    pub multiplier: u16,
    pub configuration_digest: [u8; 32],
    pub rule_pages: u16,
    pub sealed: bool,
    pub baseline: Vec<i64>,
    pub baseline_world: i64,
    pub baseline_snapshot: Pubkey,
}
#[account]
pub struct RulePage {
    pub epoch: Pubkey,
    pub country: u8,
    pub page: u8,
    pub rules: Vec<Vec<u8>>,
}
#[account]
pub struct Snapshot {
    pub registry: Pubkey,
    pub epoch: Pubkey,
    pub sequence: u64,
    pub cutoff: i64,
    pub predecessor: Pubkey,
    pub adapter: Pubkey,
    pub status: u8,
    pub frozen_pages: u16,
    pub calculated_pages: u16,
    pub evidence_digest: [u8; 32],
    pub precommitment: [u8; 32],
    pub postcommitment: [u8; 32],
    pub deadline: i64,
    pub evaluation_time: i64,
    pub published_at: i64,
    pub event_digest: [u8; 32],
    pub event_count: u64,
    pub pending: u32,
    pub closed: bool,
    pub countries: Vec<CountryOutput>,
    pub world: i64,
    pub world_confidence: i64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct CountryOutput {
    pub normalized_sum: i128,
    pub confidence_sum: i128,
    pub weight_sum: u64,
    pub complete: bool,
    pub state: i64,
    pub confidence: i64,
    pub saturated: bool,
    pub stale: bool,
    pub ratio: i64,
    pub change: i64,
    pub expressed: i64,
    pub reference_confidence: i64,
}
#[account]
pub struct EvidencePage {
    pub snapshot: Pubkey,
    pub country: u8,
    pub page: u8,
    pub frozen: bool,
    pub calculated: bool,
    pub slots: Vec<Vec<u8>>,
}
#[account]
pub struct EvidenceHistory {
    pub digest: [u8; 32],
    pub pending: u32,
    pub rejected: u32,
    pub invalid: bool,
}
#[account]
pub struct Challenge {
    pub snapshot: Pubkey,
    pub evidence: [u8; 32],
    pub id: [u8; 32],
    pub outcome: u8,
}
#[event]
pub struct ReferencePublished {
    pub snapshot: Pubkey,
    pub epoch: Pubkey,
    pub sequence: u64,
    pub evidence_cutoff: i64,
    pub evaluation_time: i64,
    pub postcommitment: [u8; 32],
}
#[event]
pub struct AdapterInconsistency {
    pub snapshot: Pubkey,
    pub challenge: [u8; 32],
}
#[error_code]
pub enum OracleError {
    #[msg("Invalid lifecycle state")]
    State,
    #[msg("Oracle paused")]
    Paused,
    #[msg("Invalid authority")]
    Authority,
    #[msg("Invalid bounds")]
    Bounds,
    #[msg("Invalid operation order")]
    Order,
    #[msg("Incomplete evidence or closure")]
    Incomplete,
    #[msg("Invalid timestamp or deadline")]
    Time,
    #[msg("Canonical encoding invalid")]
    Encoding,
    #[msg("Identity mismatch")]
    Identity,
    #[msg("Conflicting retry")]
    Conflict,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Mathematical input invalid")]
    Math,
    #[msg("Evidence disputed or invalid")]
    Disputed,
    #[msg("Stale predecessor")]
    Predecessor,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init,payer=authority,space=256,seeds=[b"registry"],bump)]
    pub registry: Account<'info, Registry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(mut,seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    pub authority: Signer<'info>,
}
#[derive(Accounts)]
#[instruction(id:u64)]
pub struct CreateEpoch<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(init,payer=authority,space=1024,seeds=[b"epoch".as_ref(),&id.to_le_bytes()],bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(country:u8,page:u8)]
pub struct AppendRule<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(mut,has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(init_if_needed,payer=authority,space=2048,seeds=[b"rules",epoch.key().as_ref(),&[country],&[page]],bump)]
    pub rules: Account<'info, RulePage>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct EpochAdmin<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(mut,has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    pub authority: Signer<'info>,
}
#[derive(Accounts)]
#[instruction(sequence:u64)]
pub struct CreateSnapshot<'info> {
    #[account(mut,seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(init,payer=authority,space=4096,seeds=[b"snapshot",epoch.key().as_ref(),&sequence.to_le_bytes()],bump)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(evidence:Vec<u8>)]
pub struct InitializeHistory<'info> {
    /// CHECK: address checked against canonical evidence hash in handler; init prevents owner substitution.
    #[account(init_if_needed,payer=authority,space=64,seeds=[b"history".as_ref(),&history_seed(&evidence)?],bump)]
    pub history: Account<'info, EvidenceHistory>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
fn history_seed(bytes: &[u8]) -> Result<[u8; 32]> {
    m(math::evidence_digest(&decode::<math::Evidence>(bytes)?))
}
#[derive(Accounts)]
#[instruction(country:u8,page:u8)]
pub struct UploadSlot<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(seeds=[b"rules",epoch.key().as_ref(),&[country],&[page]],bump,has_one=epoch)]
    pub rules: Account<'info, RulePage>,
    #[account(init_if_needed,payer=authority,space=5500,seeds=[b"page",snapshot.key().as_ref(),&[country],&[page]],bump)]
    pub page_account: Account<'info, EvidencePage>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(country:u8,page:u8)]
pub struct PageOperation<'info> {
    #[account(seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut,has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(seeds=[b"rules",epoch.key().as_ref(),&[country],&[page]],bump,has_one=epoch)]
    pub rules: Account<'info, RulePage>,
    #[account(mut,seeds=[b"page",snapshot.key().as_ref(),&[country],&[page]],bump,has_one=snapshot)]
    pub page_account: Account<'info, EvidencePage>,
    pub authority: Signer<'info>,
}
#[derive(Accounts)]
pub struct SnapshotOperation<'info> {
    #[account(mut,seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut,has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    pub authority: Signer<'info>,
}
#[derive(Accounts)]
#[instruction(id:[u8;32],evidence:[u8;32])]
pub struct RegisterChallenge<'info> {
    #[account(mut,seeds=[b"registry"],bump)]
    pub registry: Account<'info, Registry>,
    #[account(mut,has_one=registry,has_one=adapter)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(has_one=snapshot)]
    pub page_account: Account<'info, EvidencePage>,
    #[account(mut,seeds=[b"history",&evidence],bump,constraint=history.digest==evidence @ OracleError::Identity)]
    pub history: Account<'info, EvidenceHistory>,
    #[account(init_if_needed,payer=adapter,space=112,seeds=[b"challenge".as_ref(),&id],bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(mut)]
    pub adapter: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ResolveChallenge<'info> {
    #[account(mut,seeds=[b"registry"],bump)]
    pub registry: Account<'info, Registry>,
    #[account(mut,has_one=registry,has_one=adapter)]
    pub snapshot: Account<'info, Snapshot>,
    #[account(mut,has_one=snapshot)]
    pub challenge: Account<'info, Challenge>,
    #[account(mut,seeds=[b"history",&challenge.evidence],bump,constraint=history.digest==challenge.evidence @ OracleError::Identity)]
    pub history: Account<'info, EvidenceHistory>,
    pub adapter: Signer<'info>,
}
#[derive(Accounts)]
pub struct AdapterSnapshot<'info> {
    #[account(mut,seeds=[b"registry"],bump)]
    pub registry: Account<'info, Registry>,
    #[account(mut,has_one=registry,has_one=adapter)]
    pub snapshot: Account<'info, Snapshot>,
    pub adapter: Signer<'info>,
}
#[derive(Accounts)]
pub struct Publish<'info> {
    #[account(mut,seeds=[b"registry"],bump,has_one=authority)]
    pub registry: Account<'info, Registry>,
    #[account(mut,has_one=registry)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut,has_one=registry,has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
    pub authority: Signer<'info>,
}
#[derive(Accounts)]
pub struct ReadPair<'info> {
    pub epoch: Account<'info, Epoch>,
    #[account(has_one=epoch)]
    pub snapshot: Account<'info, Snapshot>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::InstructionData;
    fn epoch() -> Epoch {
        Epoch {
            registry: EMPTY,
            id: 1,
            countries: vec![[b'U', b'S']; 30],
            indicator_counts: vec![32; 30],
            multiplier: 20,
            configuration_digest: [0; 32],
            rule_pages: 0,
            sealed: false,
            baseline: vec![100_000_000; 30],
            baseline_world: 100_000_000,
            baseline_snapshot: EMPTY,
        }
    }
    fn evidence() -> math::Evidence {
        math::Evidence {
            record_id: [1; 32],
            series_id: [2; 32],
            artifact_digest: [3; 32],
            metadata_digest: [0; 32],
            unit: [4; 32],
            source: [5; 32],
            value: 1_000_000,
            published_at: Some(1),
            known_at: Some(1),
            recorded_at: 1,
            period: 1,
            quality: [10_000; 8],
        }
    }
    #[test]
    fn full_universe_page_order_is_bounded() {
        let e = epoch();
        assert_eq!(total_pages(&e), 120);
        assert_eq!(order(&e, 29, 3).unwrap(), 119);
        assert_eq!(expected_slots(&e, 29, 3).unwrap(), 8);
        assert!(order(&e, 30, 0).is_err());
        assert!(order(&e, 0, 4).is_err());
    }
    #[test]
    fn partial_pages_have_exact_length() {
        let mut e = epoch();
        e.indicator_counts[0] = 9;
        assert_eq!(expected_slots(&e, 0, 1).unwrap(), 1);
        assert_eq!(order(&e, 1, 0).unwrap(), 2);
    }
    #[test]
    fn account_allocations_fit_maximum_data() {
        let e = epoch();
        assert!(8 + e.try_to_vec().unwrap().len() <= 1024);
        let rule = math::Rule {
            series_id: [2; 32],
            transform: math::Transform::Identity,
            normalization: math::Normalization::Directional {
                lower: -1_000_000,
                upper: 1_000_000,
                direction: 1,
            },
            weight: 1,
            unit: [4; 32],
            source: [5; 32],
            source_authority: 10_000,
            comparison_period_delta: 0,
            grace_seconds: 30,
            zero_seconds: 90,
        };
        let rp = RulePage {
            epoch: EMPTY,
            country: 0,
            page: 0,
            rules: vec![rule.try_to_vec().unwrap(); 8],
        };
        assert!(8 + rp.try_to_vec().unwrap().len() <= 2048);
        let slot = math::Slot {
            current: evidence(),
            comparison: Some(evidence()),
        };
        let page = EvidencePage {
            snapshot: EMPTY,
            country: 0,
            page: 0,
            frozen: false,
            calculated: false,
            slots: vec![slot.try_to_vec().unwrap(); 8],
        };
        assert!(8 + page.try_to_vec().unwrap().len() <= 5500);
        let instruction = crate::instruction::UploadSlot {
            country: 0,
            page: 0,
            index: 0,
            slot: slot.try_to_vec().unwrap(),
        }
        .data();
        assert!(
            instruction.len() + 64 + 7 * 32 + 150 < 1232,
            "upload instruction and conservative legacy transaction envelope must fit"
        );
    }
    #[test]
    fn commitments_bind_order_and_domain() {
        let a = hash("page", &(0u8, vec![1u8, 2])).unwrap();
        let b = hash("page", &(0u8, vec![2u8, 1])).unwrap();
        assert_ne!(a, b);
        assert_ne!(a, hash("snapshot", &(0u8, vec![1u8, 2])).unwrap());
    }
    #[test]
    fn evidence_identity_includes_content() {
        let a = evidence();
        let mut b = a.clone();
        b.value += 1;
        assert_ne!(
            m(math::evidence_digest(&a)).unwrap(),
            m(math::evidence_digest(&b)).unwrap()
        );
    }
}
