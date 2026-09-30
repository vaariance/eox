use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, error::ErrorCode, state::Config};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub bond_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED],
        bump,
        token::mint = bond_mint,
        token::authority = config
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    arbiter: Pubkey,
    proposers: Vec<Pubkey>,
) -> Result<()> {
    require!(proposers.len() <= MAX_PROPOSERS, ErrorCode::TooManyProposers);

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.bond_mint = ctx.accounts.bond_mint.key();
    config.arbiter = arbiter;
    config.proposers = proposers;
    config.bump = ctx.bumps.config;
    Ok(())
}
