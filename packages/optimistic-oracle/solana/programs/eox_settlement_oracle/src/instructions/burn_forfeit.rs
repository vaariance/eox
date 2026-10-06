use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Config, Epoch},
};

#[derive(Accounts)]
pub struct BurnForfeit<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, address = config.bond_mint)]
    pub bond_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_burn_forfeit(ctx: Context<BurnForfeit>) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    require!(epoch.is_resolved(), ErrorCode::EpochNotResolved);

    let amount = epoch.burn_owed;
    require!(amount > 0, ErrorCode::NothingToBurn);
    epoch.burn_owed = 0;

    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[ctx.accounts.config.bump]]];
    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.bond_mint.to_account_info(),
                from: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )
}
