use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Epoch, EpochStatus},
};

#[derive(Accounts)]
pub struct VoidEpoch<'info> {
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
}

pub fn handle_void_epoch(ctx: Context<VoidEpoch>) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    require!(epoch.status == EpochStatus::Open, ErrorCode::InvalidEpochStatus);
    require!(
        Clock::get()?.unix_timestamp > epoch.cutoff + RESULT_DEADLINE,
        ErrorCode::DeadlineNotReached
    );
    epoch.status = EpochStatus::Voided;
    Ok(())
}
