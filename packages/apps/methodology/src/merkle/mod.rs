pub mod canonical;
pub mod tree;

pub use canonical::{canonicalize_observation, hash_observation};
pub use tree::{MerkleProofStep, MerkleTree};

pub fn compute_evidence_root(
    observations: &[crate::types::Observation],
) -> Result<[u8; 32], crate::error::EngineError> {
    let leaves: Vec<[u8; 32]> = observations
        .iter()
        .map(hash_observation)
        .collect::<Result<Vec<[u8; 32]>, crate::error::EngineError>>()?;
    let tree = MerkleTree::new(leaves)?;
    Ok(tree.root())
}
