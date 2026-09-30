use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Balance, Epoch, EpochStatus},
};

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(
        mut,
        seeds = [BALANCE_SEED, proposer_balance.owner.as_ref()],
        bump = proposer_balance.bump
    )]
    pub proposer_balance: Account<'info, Balance>,
}

pub fn handle_settle(ctx: Context<Settle>) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    require!(
        epoch.status == EpochStatus::Proposed,
        ErrorCode::InvalidEpochStatus
    );
    let claim = epoch.claim.ok_or(ErrorCode::InvalidEpochStatus)?;
    require_keys_eq!(
        ctx.accounts.proposer_balance.owner,
        claim.proposer,
        ErrorCode::InvalidEpochStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= claim.proposed_at + CHALLENGE_WINDOW,
        ErrorCode::ChallengeWindowOpen
    );

    let balance = &mut ctx.accounts.proposer_balance;
    balance.amount = balance
        .amount
        .checked_add(claim.bond)
        .ok_or(ErrorCode::Overflow)?;

    epoch.status = EpochStatus::Settled;
    Ok(())
}
