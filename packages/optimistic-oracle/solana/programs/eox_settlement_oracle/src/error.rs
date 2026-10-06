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
    #[msg("The challenge window has closed")]
    ChallengeWindowClosed,
    #[msg("The candidate result must differ from the claim it disputes")]
    NoDisagreement,
    #[msg("The arbiter's deadline has passed")]
    ArbiterWindowClosed,
    #[msg("The deadline for this step has not passed")]
    DeadlineNotReached,
    #[msg("The epoch has not been settled or voided")]
    EpochNotResolved,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
    #[msg("Nothing to burn")]
    NothingToBurn,
    #[msg("More parties than an epoch can pay out")]
    TooManyParties,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("The claim does not use the epoch's methodology")]
    WrongMethodology,
    #[msg("The candidate's evidence does not fit the grounds given for the dispute")]
    GroundsMismatch,
    #[msg("The disputed observation is not in the claim's evidence")]
    ObservationNotInClaim,
    #[msg("The proof is longer than any evidence tree allows")]
    ProofTooLong,
    #[msg("Only the program's upgrade authority can do this")]
    NotUpgradeAuthority,
    #[msg("That proposer is already listed")]
    DuplicateProposer,
}
