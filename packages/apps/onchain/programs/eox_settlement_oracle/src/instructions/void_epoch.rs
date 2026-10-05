use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    settlement,
    state::{Epoch, EpochStatus},
};

#[derive(Accounts)]
pub struct VoidEpoch<'info> {
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
}

pub fn handle_void_epoch(ctx: Context<VoidEpoch>) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    let deadline = match epoch.status {
        EpochStatus::Requested => epoch.cutoff + PROPOSAL_WINDOW,
        EpochStatus::Reset => epoch.reset_at + PROPOSAL_WINDOW,
        EpochStatus::Escalated => epoch.escalated_at + ARBITER_WINDOW,
        _ => return err!(ErrorCode::InvalidEpochStatus),
    };
    require!(
        Clock::get()?.unix_timestamp > deadline,
        ErrorCode::DeadlineNotReached
    );

    settlement::void(epoch)
}
