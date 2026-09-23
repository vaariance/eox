use thiserror::Error;

#[derive(Error, Debug)]
pub enum OracleError {
    #[error("Database error: {0}")]
    Database(#[from] tokio_postgres::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Arithmetic overflow or underflow")]
    ArithmeticOverflow,

    #[error("Division by zero")]
    DivisionByZero,

    #[error("Invalid fixed-point number format: {0}")]
    InvalidFixedPoint(String),

    #[error("Invalid Merkle proof")]
    InvalidMerkleProof,

    #[error("Invalid claim state transition from {from} to {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("Insufficient bond: required {required}, provided {provided}")]
    InsufficientBond { required: u64, provided: u64 },

    #[error("Max epoch TVL cap exceeded: cap is {cap}, attempted {attempted}")]
    MaxTvlExceeded { cap: u64, attempted: u64 },

    #[error("Observation not found: country {country}, indicator {indicator}")]
    ObservationNotFound { country: String, indicator: String },

    #[error("Arbitration failed: {0}")]
    ArbitrationFailed(String),
}
