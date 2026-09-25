use eox_engine::EngineError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum OracleError {
    #[error(transparent)]
    Engine(#[from] EngineError),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Arithmetic overflow or underflow")]
    ArithmeticOverflow,

    #[error("Division by zero")]
    DivisionByZero,

    #[error("Invalid claim state transition from {from} to {to}")]
    InvalidStateTransition { from: String, to: String },

    #[error("Insufficient bond: required {required}, provided {provided}")]
    InsufficientBond { required: u64, provided: u64 },

    #[error("Max epoch TVL cap exceeded: cap is {cap}, attempted {attempted}")]
    MaxTvlExceeded { cap: u64, attempted: u64 },

    #[error("Arbitration failed: {0}")]
    ArbitrationFailed(String),
}
