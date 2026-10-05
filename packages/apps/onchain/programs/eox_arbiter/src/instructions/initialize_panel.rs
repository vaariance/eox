use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, error::ErrorCode, state::Panel};

#[derive(Accounts)]
pub struct InitializePanel<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Panel::INIT_SPACE,
        seeds = [PANEL_SEED],
        bump
    )]
    pub panel: Account<'info, Panel>,
    /// CHECK: the panel's signing address; only its bump is recorded here.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub arbiter_authority: UncheckedAccount<'info>,
    pub bond_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED],
        bump,
        token::mint = bond_mint,
        token::authority = panel
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_panel(
    ctx: Context<InitializePanel>,
    members: [Pubkey; PANEL_SIZE],
    member_bond: u64,
) -> Result<()> {
    require!(member_bond > 0, ErrorCode::ZeroBond);
    for (i, member) in members.iter().enumerate() {
        require!(
            *member != Pubkey::default() && !members[..i].contains(member),
            ErrorCode::DuplicateMember
        );
    }

    let panel = &mut ctx.accounts.panel;
    panel.authority = ctx.accounts.authority.key();
    panel.bond_mint = ctx.accounts.bond_mint.key();
    panel.members = members;
    panel.bonded = [false; PANEL_SIZE];
    panel.member_bond = member_bond;
    panel.bump = ctx.bumps.panel;
    panel.authority_bump = ctx.bumps.arbiter_authority;
    Ok(())
}
