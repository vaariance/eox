use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    error::ErrorCode,
    merkle::{self, ProofStep, MAX_PROOF_DEPTH},
    state::{ClaimBody, Config, Dispute, Epoch, EpochStatus, GroundsKind},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum Grounds {
    /// An observation in the claim's evidence is wrong. `correction` is the leaf hash of what
    /// it should be, or `None` if it should not be in the evidence at all.
    WrongObservation {
        observation: Vec<u8>,
        path: Vec<ProofStep>,
        correction: Option<[u8; 32]>,
    },
    /// The claim's evidence leaves out an admissible observation, given by its leaf hash.
    MissingObservation { correction: [u8; 32] },
    /// The evidence is right but the result was not computed from it correctly.
    Computation,
}

#[derive(Accounts)]
pub struct DisputeClaim<'info> {
    pub disputer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch.year.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Box<Account<'info, Epoch>>,
    #[account(mut, token::mint = config.bond_mint, token::authority = disputer)]
    pub disputer_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// Only the disputed observation can be checked on-chain: a transaction is too small to carry
// the correction's proof as well, so the correction is recorded by hash for the arbiter.
fn check_grounds(claim: &ClaimBody, candidate: &ClaimBody, grounds: Grounds) -> Result<(GroundsKind, [u8; 32], [u8; 32])> {
    let same_evidence = candidate.evidence_root == claim.evidence_root;
    match grounds {
        Grounds::WrongObservation { observation, path, correction } => {
            require!(!same_evidence, ErrorCode::GroundsMismatch);
            require!(path.len() <= MAX_PROOF_DEPTH, ErrorCode::ProofTooLong);
            let leaf = merkle::leaf_hash(&observation);
            require!(
                merkle::is_member(&claim.evidence_root, &leaf, &path),
                ErrorCode::ObservationNotInClaim
            );
            require!(correction != Some(leaf), ErrorCode::NoDisagreement);
            Ok((GroundsKind::WrongObservation, leaf, correction.unwrap_or_default()))
        }
        Grounds::MissingObservation { correction } => {
            require!(!same_evidence, ErrorCode::GroundsMismatch);
            Ok((GroundsKind::MissingObservation, [0; 32], correction))
        }
        Grounds::Computation => {
            require!(same_evidence, ErrorCode::GroundsMismatch);
            Ok((GroundsKind::Computation, [0; 32], [0; 32]))
        }
    }
}

pub fn handle_dispute(ctx: Context<DisputeClaim>, candidate: ClaimBody, grounds: Grounds) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    require!(
        epoch.status == EpochStatus::Proposed,
        ErrorCode::InvalidEpochStatus
    );
    require!(
        candidate.methodology_image_id == epoch.methodology_image_id,
        ErrorCode::WrongMethodology
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
    let (kind, disputed_leaf, correction) = check_grounds(&proposal.body, &candidate, grounds)?;

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
        grounds: kind,
        disputed_leaf,
        correction,
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
