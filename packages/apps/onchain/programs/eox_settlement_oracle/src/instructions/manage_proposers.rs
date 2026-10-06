use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode, state::Config};

#[derive(Accounts)]
pub struct ManageProposers<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
}

/// Removing a proposer only stops new proposals. A bond already posted stays in its
/// epoch and is paid out by that epoch's result like any other.
pub fn handle_add_proposer(ctx: Context<ManageProposers>, proposer: Pubkey) -> Result<()> {
    let proposers = &mut ctx.accounts.config.proposers;
    require!(!proposers.contains(&proposer), ErrorCode::DuplicateProposer);
    require!(proposers.len() < MAX_PROPOSERS, ErrorCode::TooManyProposers);
    proposers.push(proposer);
    Ok(())
}

pub fn handle_remove_proposer(ctx: Context<ManageProposers>, proposer: Pubkey) -> Result<()> {
    let proposers = &mut ctx.accounts.config.proposers;
    let index = proposers
        .iter()
        .position(|p| *p == proposer)
        .ok_or(ErrorCode::NotAProposer)?;
    proposers.remove(index);
    Ok(())
}
