use anchor_lang::prelude::*;

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
    /// Only whoever can upgrade this program may set it up, so nobody can front-run the
    /// deploy and point it at their own emitter.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, EoxSettlementOracle>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ ErrorCode::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    wormhole_program: Pubkey,
    emitter_chain: u16,
    emitter_address: [u8; 32],
) -> Result<()> {
    require!(
        wormhole_program != Pubkey::default() && emitter_chain != 0 && emitter_address != [0; 32],
        ErrorCode::InvalidRelayConfig
    );

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.wormhole_program = wormhole_program;
    config.emitter_chain = emitter_chain;
    config.emitter_address = emitter_address;
    config.bump = ctx.bumps.config;
    Ok(())
}
