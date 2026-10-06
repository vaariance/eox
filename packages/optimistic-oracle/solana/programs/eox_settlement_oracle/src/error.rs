use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Only the program's upgrade authority can do this")]
    NotUpgradeAuthority,
    #[msg("The relay settings are not valid")]
    InvalidRelayConfig,
    #[msg("The epoch is not in the required state for this action")]
    InvalidEpochStatus,
    #[msg("The evidence cutoff has not passed")]
    TooEarly,
    #[msg("The deadline for a result has passed")]
    ResultDeadlinePassed,
    #[msg("The deadline for a result has not passed")]
    DeadlineNotReached,
    #[msg("The account is not a verified Wormhole VAA")]
    NotAVerifiedVaa,
    #[msg("The VAA was not emitted by the EOX adapter")]
    UnknownEmitter,
    #[msg("The VAA payload is not an EOX result")]
    MalformedPayload,
    #[msg("The result is for a different epoch")]
    WrongEpoch,
    #[msg("The result does not use the epoch's methodology")]
    WrongMethodology,
}
