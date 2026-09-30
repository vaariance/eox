use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    settlement,
    state::{Epoch, EpochStatus},
};

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
}

pub fn handle_settle(ctx: Context<Settle>) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    require!(
        epoch.status == EpochStatus::Proposed,
        ErrorCode::InvalidEpochStatus
    );

    let proposal = epoch.proposals[usize::from(epoch.round) - 1].ok_or(ErrorCode::InvalidEpochStatus)?;
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= proposal.proposed_at + CHALLENGE_WINDOW,
        ErrorCode::ChallengeWindowOpen
    );

    settlement::settle_undisputed(epoch)
}
