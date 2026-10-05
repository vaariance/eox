use anchor_lang::prelude::*;
use eox_settlement_oracle::{
    constants::EPOCH_SEED,
    state::{Epoch, EpochStatus},
};

use crate::{constants::*, error::ErrorCode, state::Case};

#[derive(Accounts)]
pub struct OpenCase<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()],
        bump = epoch.bump,
        seeds::program = eox_settlement_oracle::ID
    )]
    pub epoch: Box<Account<'info, Epoch>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Case::INIT_SPACE,
        seeds = [CASE_SEED, &epoch.year.to_le_bytes()],
        bump
    )]
    pub case: Account<'info, Case>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_case(ctx: Context<OpenCase>) -> Result<()> {
    require!(
        ctx.accounts.epoch.status == EpochStatus::Escalated,
        ErrorCode::CaseNotOpen
    );

    let case = &mut ctx.accounts.case;
    case.year = ctx.accounts.epoch.year;
    case.votes = [None; PANEL_SIZE];
    case.decided = false;
    case.bump = ctx.bumps.case;
    Ok(())
}
