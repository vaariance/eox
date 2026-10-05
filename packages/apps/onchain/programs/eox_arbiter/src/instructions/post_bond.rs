use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{constants::*, error::ErrorCode, state::Panel};

#[derive(Accounts)]
pub struct PostBond<'info> {
    pub member: Signer<'info>,
    #[account(mut, seeds = [PANEL_SEED], bump = panel.bump)]
    pub panel: Account<'info, Panel>,
    #[account(mut, token::mint = panel.bond_mint, token::authority = member)]
    pub member_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_post_bond(ctx: Context<PostBond>) -> Result<()> {
    let panel = &mut ctx.accounts.panel;
    let seat = panel
        .seat_of(&ctx.accounts.member.key())
        .ok_or(ErrorCode::NotAMember)?;
    require!(!panel.bonded[seat], ErrorCode::AlreadyBonded);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.member_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.member.to_account_info(),
            },
        ),
        panel.member_bond,
    )?;
    panel.bonded[seat] = true;
    Ok(())
}
