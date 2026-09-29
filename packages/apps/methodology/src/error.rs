use thiserror::Error;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum EngineError {
    #[error("Arithmetic overflow or underflow")]
    ArithmeticOverflow,

    #[error("Division by zero")]
    DivisionByZero,

    #[error("Invalid fixed-point number format: {0}")]
    InvalidFixedPoint(String),

    #[error("Invalid Merkle proof")]
    InvalidMerkleProof,

    #[error("Duplicate leaf detected in Merkle tree")]
    DuplicateLeaf,

    #[error("Missing raw_sha256 for observation")]
    MissingRawSha256,

    #[error("Fewer than two countries meet the coverage rule; relative performance needs at least two")]
    InsufficientCoverage,

    #[error("Snapshot cutoff {0} is not the methodology's evidence cutoff (31 July, 00:00 UTC)")]
    InvalidCutoff(String),

    #[error("Observation for country {country}, indicator {indicator} was recorded after the cutoff")]
    ObservationAfterCutoff { country: String, indicator: String },

    #[error("Observation for country {country}, indicator {indicator} does not cover the epoch's year")]
    ObservationOutsideEpoch { country: String, indicator: String },

    #[error("Duplicate observation for country {country}, indicator {indicator}")]
    DuplicateObservation { country: String, indicator: String },

    #[error("Invalid methodology version: {0}")]
    InvalidMethodologyVersion(String),

    #[error("Unknown indicator not in methodology: {0}")]
    UnknownIndicator(String),

    #[error("Country not in methodology universe: {0}")]
    UnknownCountry(String),

    #[error("Supplied evidence root does not match root computed from observations")]
    EvidenceRootMismatch,
}
