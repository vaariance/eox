use anchor_lang::prelude::*;

use crate::{constants::*, state::{Config, Epoch}};

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
    pub epoch: Box<Account<'info, Epoch>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_epoch(ctx: Context<OpenEpoch>, year: u16, methodology_image_id: [u8; 32]) -> Result<()> {
    **ctx.accounts.epoch = Epoch::new(year, cutoff_timestamp(year), methodology_image_id, ctx.bumps.epoch);
    Ok(())
}
