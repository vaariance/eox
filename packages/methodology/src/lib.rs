pub mod error;
pub mod fixed_point;
pub mod hasher;
pub mod merkle;
pub mod methodology;
pub mod types;

pub use error::EngineError;
pub use fixed_point::{Wad, WAD};
pub use hasher::{canonicalize_output_bundle, hash_output_bundle};
pub use methodology::{evaluate_methodology, get_methodology_config, MethodologyConfig};
pub use types::*;

pub fn build_snapshot(
    as_of: chrono::DateTime<chrono::Utc>,
    observations: Vec<Observation>,
) -> Result<Snapshot, EngineError> {
    let evidence_root = merkle::compute_evidence_root(&observations)?;
    Ok(Snapshot {
        as_of,
        observations,
        evidence_root,
    })
}
