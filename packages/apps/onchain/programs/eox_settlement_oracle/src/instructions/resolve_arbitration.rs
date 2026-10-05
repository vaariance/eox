use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    settlement,
    state::{Config, Epoch, EpochStatus, Resolution},
};

#[derive(Accounts)]
pub struct ResolveArbitration<'info> {
    pub arbiter: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = arbiter)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
}

pub fn handle_resolve_arbitration(
    ctx: Context<ResolveArbitration>,
    resolution: Resolution,
) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    require!(
        epoch.status == EpochStatus::Escalated,
        ErrorCode::InvalidEpochStatus
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now <= epoch.escalated_at + ARBITER_WINDOW,
        ErrorCode::ArbiterWindowClosed
    );

    settlement::settle_arbitrated(epoch, resolution)
}
