use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Too many proposers")]
    TooManyProposers,
    #[msg("Bond must be greater than zero")]
    ZeroBond,
    #[msg("Signer is not a permitted proposer")]
    NotAProposer,
    #[msg("The epoch is not in the required state for this action")]
    InvalidEpochStatus,
    #[msg("The evidence cutoff has not passed")]
    TooEarly,
    #[msg("The proposal window has closed")]
    ProposalWindowClosed,
    #[msg("The challenge window is still open")]
    ChallengeWindowOpen,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
    #[msg("Arithmetic overflow")]
    Overflow,
}
