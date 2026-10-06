use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{ClaimBody, Config, Epoch, EpochStatus, Proposal},
};

#[derive(Accounts)]
pub struct Propose<'info> {
    pub proposer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    #[account(mut, token::mint = config.bond_mint, token::authority = proposer)]
    pub proposer_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_propose(ctx: Context<Propose>, body: ClaimBody) -> Result<()> {
    let proposer = ctx.accounts.proposer.key();
    require!(
        ctx.accounts.config.proposers.contains(&proposer),
        ErrorCode::NotAProposer
    );

    let epoch = &mut ctx.accounts.epoch;
    require!(
        body.methodology_image_id == epoch.methodology_image_id,
        ErrorCode::WrongMethodology
    );
    let now = Clock::get()?.unix_timestamp;
    match epoch.status {
        EpochStatus::Requested => {
            require!(now >= epoch.cutoff, ErrorCode::TooEarly);
            require!(
                now <= epoch.cutoff + PROPOSAL_WINDOW,
                ErrorCode::ProposalWindowClosed
            );
        }
        EpochStatus::Reset => require!(
            now <= epoch.reset_at + PROPOSAL_WINDOW,
            ErrorCode::ProposalWindowClosed
        ),
        _ => return err!(ErrorCode::InvalidEpochStatus),
    }

    // The bond doubles after the first dispute.
    let bond = epoch
        .bond
        .checked_mul(1u64 << epoch.round)
        .ok_or(ErrorCode::Overflow)?;

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.proposer_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.proposer.to_account_info(),
            },
        ),
        bond,
    )?;

    let slot = usize::from(epoch.round);
    epoch.proposals[slot] = Some(Proposal {
        body,
        proposer,
        bond,
        proposed_at: now,
    });
    epoch.round += 1;
    epoch.status = EpochStatus::Proposed;
    Ok(())
}
