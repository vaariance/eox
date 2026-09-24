use crate::error::OracleError;
use crate::types::OutputBundle;
use sha2::{Digest, Sha256};

pub fn hash_output_bundle(bundle: &OutputBundle) -> Result<[u8; 32], OracleError> {
    let serialized = serde_json::to_vec(bundle)?;
    let mut hasher = Sha256::new();
    hasher.update(&serialized);
    Ok(hasher.finalize().into())
}
