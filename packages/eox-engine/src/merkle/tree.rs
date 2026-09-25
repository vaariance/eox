use crate::error::EngineError;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MerkleProofStep {
    pub is_right: bool,
    pub sibling: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct MerkleTree {
    leaves: Vec<[u8; 32]>,
    layers: Vec<Vec<[u8; 32]>>,
}

impl MerkleTree {
    pub fn hash_leaf(data: &[u8]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update([0x00]);
        hasher.update(data);
        hasher.finalize().into()
    }

    pub fn hash_node(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update([0x01]);
        hasher.update(left);
        hasher.update(right);
        hasher.finalize().into()
    }

    pub fn new(mut leaves: Vec<[u8; 32]>) -> Result<Self, EngineError> {
        if leaves.is_empty() {
            let empty_root = Sha256::digest(b"").into();
            return Ok(Self {
                leaves: vec![],
                layers: vec![vec![empty_root]],
            });
        }

        leaves.sort();
        if leaves.windows(2).any(|w| w[0] == w[1]) {
            return Err(EngineError::DuplicateLeaf);
        }

        let mut layers = Vec::new();
        layers.push(leaves.clone());

        let mut current = leaves.clone();
        while current.len() > 1 {
            let mut next = Vec::with_capacity(current.len().div_ceil(2));
            let mut i = 0;
            while i < current.len() {
                if i + 1 < current.len() {
                    next.push(Self::hash_node(current[i], current[i + 1]));
                    i += 2;
                } else {
                    next.push(current[i]);
                    i += 1;
                }
            }
            layers.push(next.clone());
            current = next;
        }

        Ok(Self { leaves, layers })
    }

    pub fn root(&self) -> [u8; 32] {
        self.layers
            .last()
            .and_then(|layer| layer.first().copied())
            .unwrap_or_else(|| Sha256::digest(b"").into())
    }

    pub fn generate_proof(&self, leaf: &[u8; 32]) -> Result<Vec<MerkleProofStep>, EngineError> {
        let mut index = self
            .leaves
            .iter()
            .position(|l| l == leaf)
            .ok_or(EngineError::InvalidMerkleProof)?;

        let mut proof = Vec::new();
        for layer in &self.layers[..self.layers.len() - 1] {
            let is_right = index % 2 == 1;
            if is_right {
                proof.push(MerkleProofStep {
                    is_right: true,
                    sibling: layer[index - 1],
                });
                index /= 2;
            } else if index + 1 < layer.len() {
                proof.push(MerkleProofStep {
                    is_right: false,
                    sibling: layer[index + 1],
                });
                index /= 2;
            } else {
                index /= 2;
            }
        }

        Ok(proof)
    }

    pub fn verify_proof(
        root: &[u8; 32],
        leaf: &[u8; 32],
        proof: &[MerkleProofStep],
    ) -> bool {
        let mut current = *leaf;
        for step in proof {
            current = if step.is_right {
                Self::hash_node(step.sibling, current)
            } else {
                Self::hash_node(current, step.sibling)
            };
        }
        &current == root
    }
}
