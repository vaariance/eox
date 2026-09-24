use crate::error::OracleError;
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
    pub fn new(mut leaves: Vec<[u8; 32]>) -> Self {
        if leaves.is_empty() {
            let empty_root = Sha256::digest(b"").into();
            return Self {
                leaves: vec![],
                layers: vec![vec![empty_root]],
            };
        }

        leaves.sort();

        let mut layers = Vec::new();
        layers.push(leaves.clone());

        let mut current = leaves.clone();
        while current.len() > 1 {
            let mut next = Vec::with_capacity((current.len() + 1) / 2);
            for chunk in current.chunks(2) {
                let left = chunk[0];
                let right = if chunk.len() > 1 { chunk[1] } else { left };
                let mut hasher = Sha256::new();
                hasher.update(&left);
                hasher.update(&right);
                next.push(hasher.finalize().into());
            }
            layers.push(next.clone());
            current = next;
        }

        Self { leaves, layers }
    }

    pub fn root(&self) -> [u8; 32] {
        self.layers
            .last()
            .and_then(|layer| layer.first().copied())
            .unwrap_or_else(|| Sha256::digest(b"").into())
    }

    pub fn generate_proof(&self, leaf: &[u8; 32]) -> Result<Vec<MerkleProofStep>, OracleError> {
        let mut index = self
            .leaves
            .iter()
            .position(|l| l == leaf)
            .ok_or(OracleError::InvalidMerkleProof)?;

        let mut proof = Vec::new();
        for layer in &self.layers[..self.layers.len() - 1] {
            let is_right = index % 2 == 1;
            let sibling_index = if is_right {
                index - 1
            } else if index + 1 < layer.len() {
                index + 1
            } else {
                index
            };

            proof.push(MerkleProofStep {
                is_right,
                sibling: layer[sibling_index],
            });

            index /= 2;
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
            let mut hasher = Sha256::new();
            if step.is_right {
                hasher.update(&step.sibling);
                hasher.update(&current);
            } else {
                hasher.update(&current);
                hasher.update(&step.sibling);
            }
            current = hasher.finalize().into();
        }
        &current == root
    }
}
