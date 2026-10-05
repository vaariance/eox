use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Member bond must be greater than zero")]
    ZeroBond,
    #[msg("Panel members must be distinct")]
    DuplicateMember,
    #[msg("Signer is not a panel member")]
    NotAMember,
    #[msg("This member has already posted their bond")]
    AlreadyBonded,
    #[msg("This member has not posted their bond")]
    MemberNotBonded,
    #[msg("The epoch is not escalated to the arbiter")]
    CaseNotOpen,
    #[msg("This member has already voted")]
    AlreadyVoted,
    #[msg("The arbiter's deadline has passed")]
    DeadlinePassed,
}
