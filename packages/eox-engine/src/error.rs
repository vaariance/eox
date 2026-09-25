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

    #[error("Observation not found: country {country}, indicator {indicator}")]
    ObservationNotFound { country: String, indicator: String },

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
