use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Balance, Claim, Config, Epoch, EpochStatus},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct ProposeArgs {
    pub evidence_root: [u8; 32],
    pub methodology_image_id: [u8; 32],
    pub output_hash: [u8; 32],
    pub resolution_uri_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct Propose<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut, token::mint = config.bond_mint, token::authority = proposer)]
    pub proposer_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = proposer,
        space = 8 + Balance::INIT_SPACE,
        seeds = [BALANCE_SEED, proposer.key().as_ref()],
        bump
    )]
    pub balance: Account<'info, Balance>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_propose(ctx: Context<Propose>, args: ProposeArgs) -> Result<()> {
    let proposer = ctx.accounts.proposer.key();
    require!(
        ctx.accounts.config.proposers.contains(&proposer),
        ErrorCode::NotAProposer
    );

    let epoch = &mut ctx.accounts.epoch;
    require!(
        epoch.status == EpochStatus::Requested,
        ErrorCode::InvalidEpochStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now >= epoch.cutoff, ErrorCode::TooEarly);
    require!(
        now <= epoch.cutoff + PROPOSAL_WINDOW,
        ErrorCode::ProposalWindowClosed
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.proposer_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.proposer.to_account_info(),
            },
        ),
        epoch.bond,
    )?;

    let balance = &mut ctx.accounts.balance;
    balance.owner = proposer;
    balance.bump = ctx.bumps.balance;

    epoch.claim = Some(Claim {
        evidence_root: args.evidence_root,
        methodology_image_id: args.methodology_image_id,
        output_hash: args.output_hash,
        resolution_uri_hash: args.resolution_uri_hash,
        proposer,
        bond: epoch.bond,
        proposed_at: now,
    });
    epoch.status = EpochStatus::Proposed;
    Ok(())
}
