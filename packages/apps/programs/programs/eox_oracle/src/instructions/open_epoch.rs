use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Config, Epoch, EpochStatus},
};

#[derive(Accounts)]
#[instruction(year: u16)]
pub struct OpenEpoch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + Epoch::INIT_SPACE,
        seeds = [EPOCH_SEED, &year.to_le_bytes()],
        bump
    )]
    pub epoch: Account<'info, Epoch>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_epoch(ctx: Context<OpenEpoch>, year: u16, bond: u64) -> Result<()> {
    require!(bond > 0, ErrorCode::ZeroBond);

    let epoch = &mut ctx.accounts.epoch;
    epoch.year = year;
    epoch.cutoff = cutoff_timestamp(year);
    epoch.bond = bond;
    epoch.status = EpochStatus::Requested;
    epoch.claim = None;
    epoch.bump = ctx.bumps.epoch;
    Ok(())
}
