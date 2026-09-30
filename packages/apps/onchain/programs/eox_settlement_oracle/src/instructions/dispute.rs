use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{ClaimBody, Config, Dispute, Epoch, EpochStatus},
};

#[derive(Accounts)]
pub struct DisputeClaim<'info> {
    pub disputer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut, token::mint = config.bond_mint, token::authority = disputer)]
    pub disputer_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_dispute(ctx: Context<DisputeClaim>, candidate: ClaimBody) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    require!(
        epoch.status == EpochStatus::Proposed,
        ErrorCode::InvalidEpochStatus
    );

    let index = usize::from(epoch.round) - 1;
    let proposal = epoch.proposals[index].ok_or(ErrorCode::InvalidEpochStatus)?;
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < proposal.proposed_at + CHALLENGE_WINDOW,
        ErrorCode::ChallengeWindowClosed
    );
    require!(
        candidate.output_hash != proposal.body.output_hash,
        ErrorCode::NoDisagreement
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.disputer_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.disputer.to_account_info(),
            },
        ),
        proposal.bond,
    )?;

    epoch.disputes[index] = Some(Dispute {
        candidate,
        disputer: ctx.accounts.disputer.key(),
        bond: proposal.bond,
        disputed_at: now,
    });

    // The first dispute only resets the claim; a second one goes to the arbiter.
    if epoch.round == 1 {
        epoch.status = EpochStatus::Reset;
        epoch.reset_at = now;
    } else {
        epoch.status = EpochStatus::Escalated;
        epoch.escalated_at = now;
    }
    Ok(())
}
