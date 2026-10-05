use eox_engine::EngineError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum OracleError {
    #[error(transparent)]
    Engine(#[from] EngineError),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Chain error: {0}")]
    Chain(String),

    #[error("Inconsistent evidence: {0}")]
    InconsistentEvidence(String),
}
