use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, error::ErrorCode, program::EoxSettlementOracle, state::Config};

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
    /// Only whoever can upgrade this program may set it up, so nobody can front-run the
    /// deploy and install their own arbiter and proposers.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, EoxSettlementOracle>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ ErrorCode::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    arbiter: Pubkey,
    proposers: Vec<Pubkey>,
) -> Result<()> {
    require!(proposers.len() <= MAX_PROPOSERS, ErrorCode::TooManyProposers);
    for (i, proposer) in proposers.iter().enumerate() {
        require!(!proposers[..i].contains(proposer), ErrorCode::DuplicateProposer);
    }

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.bond_mint = ctx.accounts.bond_mint.key();
    config.arbiter = arbiter;
    config.proposers = proposers;
    config.bump = ctx.bumps.config;
    Ok(())
}
