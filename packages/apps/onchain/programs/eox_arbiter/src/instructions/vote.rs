use anchor_lang::prelude::*;
use eox_settlement_oracle::{
    constants::{ARBITER_WINDOW, EPOCH_SEED},
    cpi::{accounts::ResolveArbitration, resolve_arbitration},
    program::EoxSettlementOracle,
    state::{Epoch, EpochStatus, Resolution},
};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Case, Panel, Vote},
};

#[derive(Accounts)]
pub struct CastVote<'info> {
    pub member: Signer<'info>,
    #[account(seeds = [PANEL_SEED], bump = panel.bump)]
    pub panel: Account<'info, Panel>,
    #[account(mut, seeds = [CASE_SEED, &case.year.to_le_bytes()], bump = case.bump)]
    pub case: Account<'info, Case>,
    #[account(
        mut,
        seeds = [EPOCH_SEED, &case.year.to_le_bytes()],
        bump = epoch.bump,
        seeds::program = eox_settlement_oracle::ID
    )]
    pub epoch: Box<Account<'info, Epoch>>,
    /// CHECK: the settlement oracle's config; the oracle validates it during the ruling.
    pub oracle_config: UncheckedAccount<'info>,
    /// CHECK: the panel's signing address, which the oracle accepts as its arbiter.
    #[account(seeds = [AUTHORITY_SEED], bump = panel.authority_bump)]
    pub arbiter_authority: UncheckedAccount<'info>,
    pub oracle_program: Program<'info, EoxSettlementOracle>,
}

pub fn handle_vote(
    ctx: Context<CastVote>,
    choice: Resolution,
    rationale_hash: [u8; 32],
) -> Result<()> {
    let seat = ctx
        .accounts
        .panel
        .seat_of(&ctx.accounts.member.key())
        .ok_or(ErrorCode::NotAMember)?;
    require!(ctx.accounts.panel.bonded[seat], ErrorCode::MemberNotBonded);

    let epoch = &ctx.accounts.epoch;
    require!(epoch.status == EpochStatus::Escalated, ErrorCode::CaseNotOpen);
    let now = Clock::get()?.unix_timestamp;
    require!(
        now <= epoch.escalated_at + ARBITER_WINDOW,
        ErrorCode::DeadlinePassed
    );

    let case = &mut ctx.accounts.case;
    require!(case.votes[seat].is_none(), ErrorCode::AlreadyVoted);
    case.votes[seat] = Some(Vote {
        choice,
        rationale_hash,
        voted_at: now,
    });

    let Some(resolution) = case.decision() else {
        return Ok(());
    };
    case.decided = true;

    let signer_seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &[ctx.accounts.panel.authority_bump]]];
    resolve_arbitration(
        CpiContext::new_with_signer(
            ctx.accounts.oracle_program.key(),
            ResolveArbitration {
                arbiter: ctx.accounts.arbiter_authority.to_account_info(),
                config: ctx.accounts.oracle_config.to_account_info(),
                epoch: ctx.accounts.epoch.to_account_info(),
            },
            signer_seeds,
        ),
        resolution,
    )
}
